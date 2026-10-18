#!/usr/bin/env python3
"""Guided fresh deployment from AWS CloudShell. Uses its existing AWS login."""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = 'robbyweeds/Inventoryapp'


class InstallError(Exception):
    pass


def aws(region, *args):
    process = subprocess.run(['aws', '--region', region, *args, '--output', 'json', '--no-cli-pager'],
                             text=True, capture_output=True)
    if process.returncode:
        raise InstallError(process.stderr.strip() or 'AWS CLI request failed.')
    return json.loads(process.stdout) if process.stdout.strip() else {}


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Inventoryapp-guided-installer'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def ask(label, default='', pattern=None):
    while True:
        value = input(label + (f' [{default}]' if default else '') + ': ').strip() or default
        if value and (not pattern or re.fullmatch(pattern, value)):
            return value
        print('Please enter a valid value.')


def public_zone(region, domain):
    try:
        zones = aws(region, 'route53', 'list-hosted-zones')['HostedZones']
    except InstallError:
        print('Cannot list Route 53 zones. You can add the DNS A record with your DNS provider.')
        return ''
    matches = [zone for zone in zones if not zone.get('Config', {}).get('PrivateZone') and
               (domain == zone['Name'].rstrip('.') or domain.endswith('.' + zone['Name'].rstrip('.')))]
    matches.sort(key=lambda zone: len(zone['Name']), reverse=True)
    if matches:
        zone = matches[0]
        print(f"Found public Route 53 zone: {zone['Name']}")
        if input('Create the hostname automatically in this zone? [Y/n]: ').strip().lower() != 'n':
            return zone['Id'].split('/')[-1]
    print('Keep this window open. When the IP appears, add an A record at your DNS provider.')
    return ''


def source_release():
    metadata = json.loads(fetch(f'https://api.github.com/repos/{REPOSITORY}/commits/main'))
    commit = metadata['sha']
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise InstallError('GitHub did not return an exact source revision.')
    content = fetch(f'https://raw.githubusercontent.com/{REPOSITORY}/{commit}/deploy/aws/cloudformation.json')
    template = json.loads(content)
    return commit, template


def parameter_values(company, domain, email, zone, availability_zone, commit, prefix_list=''):
    return [{'ParameterKey': key, 'ParameterValue': value} for key, value in {
        'CompanyName': company, 'DomainName': domain, 'CertificateEmail': email,
        'HostedZoneId': zone, 'AvailabilityZone': availability_zone, 'SourceCommit': commit,
        'CloudFrontPrefixListId': prefix_list,
    }.items()]


def outputs(region, stack):
    description = aws(region, 'cloudformation', 'describe-stacks', '--stack-name', stack)['Stacks'][0]
    return description, {entry['OutputKey']: entry['OutputValue'] for entry in description.get('Outputs', [])}


def progress(region, stack, domain, managed_dns):
    previous = None
    ip_shown = False
    deadline = time.monotonic() + 5400
    while time.monotonic() < deadline:
        description, values = outputs(region, stack)
        status = description['StackStatus']
        if status != previous:
            print('AWS status: ' + status, flush=True)
            previous = status
        if not ip_shown:
            try:
                resources = aws(region, 'cloudformation', 'describe-stack-resources', '--stack-name', stack)['StackResources']
                ip = next((item.get('PhysicalResourceId') for item in resources
                           if item['LogicalResourceId'] == 'PublicIp' and item.get('PhysicalResourceId')), None)
                if ip:
                    # EIP physical IDs can be allocation IDs; resolve the actual public address.
                    if ip.startswith('eipalloc-'):
                        ip = aws(region, 'ec2', 'describe-addresses', '--allocation-ids', ip)['Addresses'][0]['PublicIp']
                    print(f'Server address: {ip}', flush=True)
                    if domain and not managed_dns:
                        print(f'ADD DNS NOW: A record {domain} -> {ip}. Installation waits for DNS.', flush=True)
                    ip_shown = True
            except InstallError:
                pass  # Status/errors remain visible in CloudFormation even if progress lookup is unavailable.
        if status == 'CREATE_COMPLETE':
            verify_public_website(values['Website'])
            return values
        if status not in ('CREATE_IN_PROGRESS',):
            events = aws(region, 'cloudformation', 'describe-stack-events', '--stack-name', stack).get('StackEvents', [])
            for event in events:
                if event['ResourceStatus'].endswith('FAILED'):
                    print(event['LogicalResourceId'] + ': ' + event.get('ResourceStatusReason', 'See AWS events.'))
            raise InstallError('Setup did not finish. Open the stack Events and Session Manager logs. '
                               'Resources were preserved for troubleshooting and may still incur charges.')
        time.sleep(15)
    raise InstallError('Installer wait timed out. Check CloudFormation before creating another stack.')


def website_settings(region):
    print('Website address: AWS creates a secure cloudfront.net hostname automatically.')
    print('No purchased domain or DNS changes are needed for the default option.')
    if input('Use your own existing domain instead? [y/N]: ').strip().lower() == 'y':
        domain = ask('Unused website hostname, e.g. equipment.example.com', pattern=r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+')
        email = ask('Email for HTTPS certificate notices', pattern=r'[A-Za-z0-9._+%\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
        return domain, email, public_zone(region, domain), ''
    prefix_lists = aws(region, 'ec2', 'describe-managed-prefix-lists', '--filters',
                       'Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing').get('PrefixLists', [])
    if not prefix_lists:
        raise InstallError('CloudFront origin-facing prefix list is unavailable in this Region. Choose another Region.')
    return '', '', '', prefix_lists[0]['PrefixListId']


def verify_public_website(website):
    base = website.removesuffix('/equiptags/')
    if not base.startswith('https://'):
        raise InstallError('The website must use HTTPS.')
    print('Checking the public HTTPS website...', flush=True)
    for attempt in range(18):
        try:
            with urllib.request.urlopen(base + '/equiptags-api/health', timeout=20) as response:
                if response.status == 200:
                    health = json.load(response)
                    if isinstance(health, dict) and health.get('ok') is True:
                        return
        except (OSError, ValueError):
            pass
        if attempt < 17:
            time.sleep(10)
    raise InstallError('AWS finished provisioning but public website verification failed. '
                       'Check CloudFront/origin settings and use --resume; no second stack is needed.')


def show_result(region, stack, values):
    print('\nREADY\nWebsite: ' + values['Website'] + '\nAdmin:   ' + values['AdminPage'])
    print('Server:  ' + values['ServerConsole'])
    print('Initial PINs are stored in AWS Secrets Manager: ' + values['CredentialsSecretArn'])
    print('Daily backups: s3://' + values['BackupBucket'] + '/inventory/')
    print('Keep stack name for recovery: ' + stack)
    print('Company setup: ' + values['Website'].rstrip('/') + '/admin/setup/')
    print('Open Company setup; use the master PIN for divisions, then Manager access for crews, trailers, and CSV equipment import.')
    if input('Show initial PINs in this private CloudShell window? [y/N]: ').strip().lower() == 'y':
        secret = aws(region, 'secretsmanager', 'get-secret-value', '--secret-id', values['CredentialsSecretArn'])
        codes = json.loads(secret['SecretString'])
        print('Admin PIN:   ' + codes['master_pin'])
        print('Manager PIN: ' + codes['manager_pin'])
        print('These are initial PINs. Later changes through Admin are saved in the app database.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume', metavar='STACK_NAME', help='Check an existing installation; never creates another server.')
    parser.add_argument('--region', default=os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION') or 'us-east-1')
    args = parser.parse_args()
    region = args.region
    print('Inventoryapp — guided AWS setup\nUses your current AWS login; no access keys or SSH key are needed.')
    identity = aws(region, 'sts', 'get-caller-identity')
    print('AWS account: ' + identity['Account'] + ' | Region: ' + region)
    if args.resume:
        description, current = outputs(region, args.resume)
        parameters = {item['ParameterKey']: item['ParameterValue'] for item in description.get('Parameters', [])}
        values = progress(region, args.resume, parameters['DomainName'], bool(parameters.get('HostedZoneId')))
        show_result(region, args.resume, values)
        return
    company = ask('Company name', pattern=r'[^\r\n]{1,100}')
    domain, email, zone, prefix_list = website_settings(region)
    slug = re.sub('[^a-z0-9-]', '-', company.lower()).strip('-')[:35] or 'company'
    stack = ask('Installation name', 'inventory-' + slug, r'[A-Za-z][A-Za-z0-9-]{0,79}')
    # Refuse accidental duplication/updates instead of silently replacing a company's server.
    existing = aws(region, 'cloudformation', 'list-stacks', '--stack-status-filter', 'CREATE_IN_PROGRESS',
                   'CREATE_COMPLETE', 'CREATE_FAILED', 'UPDATE_COMPLETE', 'ROLLBACK_COMPLETE', 'ROLLBACK_FAILED',
                   'UPDATE_ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_FAILED', 'DELETE_FAILED').get('StackSummaries', [])
    if any(item['StackName'] == stack for item in existing):
        raise InstallError('That installation name already exists. Use --resume ' + stack + ' or choose another name.')
    zones = aws(region, 'ec2', 'describe-availability-zones', '--filters', 'Name=state,Values=available',
                'Name=zone-type,Values=availability-zone')['AvailabilityZones']
    if not zones:
        raise InstallError('No standard Availability Zone is available in this Region.')
    supported = aws(region, 'ec2', 'describe-instance-type-offerings', '--location-type', 'availability-zone',
                    '--filters', 'Name=instance-type,Values=t3.small')['InstanceTypeOfferings']
    offered = {item['Location'] for item in supported}
    available = sorted(zone['ZoneName'] for zone in zones if zone['ZoneName'] in offered)
    if not available:
        raise InstallError('t3.small is not offered in this Region. Choose another supported AWS Region.')
    commit, template = source_release()
    print('\nWill create: one t3.small Ubuntu server, 16 GiB root disk, 30 GiB encrypted company disk,')
    print('public IP/network, HTTPS, initial PIN secret, and private S3 backups. AWS charges apply.')
    print('Website: ' + (domain if domain else 'AWS-assigned cloudfront.net address, including HTTPS (CloudFront charges apply).'))
    print('Company storage, backups, and initial secret are retained on deletion. No automatic backup expiry.')
    print('The stack has deletion protection. On setup failure resources remain for troubleshooting and billing continues.')
    print('Pinned source: ' + commit)
    if input('Create this installation in the AWS account shown above? Type CREATE: ').strip() != 'CREATE':
        print('Cancelled. No AWS resources were created.')
        return
    with tempfile.TemporaryDirectory(prefix='inventoryapp-install-') as directory:
        path = pathlib.Path(directory)
        (path / 'template.json').write_text(json.dumps(template))
        (path / 'parameters.json').write_text(json.dumps(parameter_values(company, domain, email, zone, available[0], commit, prefix_list)))
        aws(region, 'cloudformation', 'validate-template', '--template-body', 'file://' + str(path / 'template.json'))
        created = aws(region, 'cloudformation', 'create-stack', '--stack-name', stack,
                      '--template-body', 'file://' + str(path / 'template.json'),
                      '--parameters', 'file://' + str(path / 'parameters.json'), '--capabilities', 'CAPABILITY_IAM',
                      '--enable-termination-protection', '--disable-rollback',
                      '--tags', 'Key=Application,Value=Inventoryapp')
    print('Stack created: ' + created['StackId'])
    print('Usually takes 15–35 minutes including website distribution; custom DNS may take longer. Keep this window open.')
    print('If disconnected, rerun this installer with --resume ' + stack + ' --region ' + region)
    print('Stack: https://' + region + '.console.aws.amazon.com/cloudformation/home?region=' + region + '#/stacks')
    values = progress(region, stack, domain, bool(zone))
    show_result(region, stack, values)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nInstaller interrupted; any existing stack keeps running. Use --resume to check it.', file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        print('Setup stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
