#!/usr/bin/env python3
"""EC2 first-boot setup. No secrets are printed or placed in EC2 user data."""
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

CONFIG = pathlib.Path('/etc/inventoryapp-bootstrap.json')
SOURCE_URL = 'https://github.com/robbyweeds/Inventoryapp.git'
DATA_ROOT = pathlib.Path('/srv/inventory-data')
APP = DATA_ROOT / 'app'


def run(args, *, cwd=None, sensitive=False, timeout=1200):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True,
                            timeout=timeout, env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive',
                                                  'PATH': '/usr/local/bin:/usr/bin:/bin:/snap/bin'})
    if result.returncode:
        detail = '' if sensitive else result.stderr[-1800:]
        raise RuntimeError(f'{args[0]} failed (exit {result.returncode}). {detail}')
    return result.stdout.strip()


def download(url, destination):
    request = urllib.request.Request(url, headers={'User-Agent': 'Inventoryapp-AWS-installer'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=120) as response, open(destination, 'wb') as output:
                shutil.copyfileobj(response, output)
            return
        except Exception:
            if attempt == 4:
                raise
            time.sleep(5)


def aws(config, *args, sensitive=False):
    text = run(['/usr/local/bin/aws', '--region', config['region'], *args, '--output', 'json'],
               sensitive=sensitive)
    return json.loads(text) if text else None


def initial_credentials(value):
    """Reuse saved initial codes after retries; never regenerate on normal reboot."""
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        if all(isinstance(parsed.get(key), str) and re.fullmatch(r'\d{4}', parsed[key]) for key in ('master_pin', 'manager_pin')) \
                and parsed['master_pin'] != parsed['manager_pin']:
            return parsed, False
        raise ValueError('The credentials secret has an unexpected format; refusing to replace it.')
    master = f'{secrets.randbelow(10000):04d}'
    manager = master
    while manager == master:
        manager = f'{secrets.randbelow(10000):04d}'
    return {'master_pin': master, 'manager_pin': manager}, True


def protected_env(path, values):
    # JSON double quoting also escapes the characters meaningful to EnvironmentFile.
    content = ''.join(f'{key}={json.dumps(str(value), ensure_ascii=False)}\n' for key, value in values.items())
    path = pathlib.Path(path)
    path.write_text(content)
    path.chmod(0o600)


def data_device(volume_id, sys_root=pathlib.Path('/sys/block')):
    expected = volume_id.replace('-', '')
    for serial in sys_root.glob('*/device/serial'):
        if serial.read_text().strip().replace('-', '') == expected:
            return '/dev/' + serial.parents[1].name
    return None


def mount_data(config):
    print('Waiting for the dedicated company data volume...', flush=True)
    deadline = time.monotonic() + 600
    device = None
    while time.monotonic() < deadline:
        device = data_device(config['volume_id'])
        if device:
            break
        time.sleep(5)
    if not device:
        raise RuntimeError('Company data volume did not attach. No disk was formatted.')
    filesystem = subprocess.run(['blkid', '-s', 'TYPE', '-o', 'value', device], text=True, capture_output=True)
    if filesystem.returncode not in (0, 2):
        raise RuntimeError('Cannot inspect data volume; refusing to format it.')
    kind = filesystem.stdout.strip()
    if not kind:
        signatures = json.loads(run(['wipefs', '--no-act', '--json', device])).get('signatures', [])
        children = run(['lsblk', '--noheadings', '--raw', '--output', 'NAME', device]).splitlines()
        if signatures or len(children) != 1:
            raise RuntimeError('Unexpected volume signatures/partitions; refusing to format it.')
        run(['mkfs.ext4', '-F', device])
    elif kind != 'ext4':
        raise RuntimeError('Expected ext4 company storage; refusing to change the volume.')
    uuid = run(['blkid', '-s', 'UUID', '-o', 'value', device])
    if not re.fullmatch(r'[a-fA-F0-9-]+', uuid):
        raise RuntimeError('Invalid data volume UUID.')
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    fstab = pathlib.Path('/etc/fstab')
    entry = f'UUID={uuid} /srv/inventory-data ext4 defaults,nofail,x-systemd.device-timeout=120 0 2\n'
    if f'UUID={uuid} ' not in fstab.read_text():
        with fstab.open('a') as output:
            output.write(entry)
    run(['systemctl', 'daemon-reload'])
    if not os.path.ismount(DATA_ROOT):
        run(['mount', str(DATA_ROOT)])
    mounted_uuid = run(['findmnt', '--noheadings', '--output', 'UUID', '--target', str(DATA_ROOT)])
    if mounted_uuid != uuid:
        raise RuntimeError('Company mount does not match its expected volume.')


def symlink(source, destination):
    destination = pathlib.Path(destination)
    if destination.is_symlink() and destination.resolve() == pathlib.Path(source).resolve():
        return
    if destination.exists() or destination.is_symlink():
        raise RuntimeError(f'{destination} already exists; refusing to replace it.')
    destination.symlink_to(source, target_is_directory=True)


def install_node(work):
    version = 'v24.22.0'
    filename = f'node-{version}-linux-x64.tar.xz'
    archive, checksums = work / filename, work / 'SHASUMS256.txt'
    download(f'https://nodejs.org/dist/{version}/{filename}', archive)
    download(f'https://nodejs.org/dist/{version}/SHASUMS256.txt', checksums)
    expected = next(line.split()[0] for line in checksums.read_text().splitlines()
                    if line.split()[-1] == filename)
    with archive.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if not secrets.compare_digest(actual, expected):
        raise RuntimeError('Node archive checksum did not match. Installation stopped.')
    run(['tar', '-xJf', str(archive), '-C', '/usr/local', '--strip-components=1'])


def install_cli(work):
    archive = work / 'awscliv2.zip'
    download('https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip', archive)
    run(['unzip', '-q', str(archive), '-d', str(work)])
    args = [str(work / 'aws/install')]
    if pathlib.Path('/usr/local/bin/aws').exists():
        args.append('--update')
    run(args)


def install_source(config):
    marker = DATA_ROOT / 'installed-commit'
    if marker.exists() and marker.read_text().strip() != config['source_commit']:
        raise RuntimeError('This data volume already has a different release; use the update guide.')
    if subprocess.run(['id', 'equiptags'], capture_output=True).returncode:
        run(['useradd', '--system', '--home', '/srv/equiptags', '--shell', '/usr/sbin/nologin', 'equiptags'])
    if not APP.exists():
        APP.mkdir()
    run(['chown', '-R', 'equiptags:equiptags', str(APP)])
    user = ['runuser', '-u', 'equiptags', '--']
    if not (APP / '.git').exists():
        if any(APP.iterdir()):
            raise RuntimeError('Application folder is not empty; refusing to replace its contents.')
        run(user + ['git', 'clone', '--no-checkout', '--depth', '1', '--branch', 'main', SOURCE_URL, str(APP)])
    if run(user + ['git', '-C', str(APP), 'remote', 'get-url', 'origin']) != SOURCE_URL:
        raise RuntimeError('Unexpected source repository; installation stopped.')
    run(user + ['git', '-C', str(APP), 'fetch', '--depth', '1', 'origin', config['source_commit']])
    run(user + ['git', '-C', str(APP), 'checkout', '-B', 'main', config['source_commit']])
    run(user + ['git', '-C', str(APP), 'branch', '--set-upstream-to=origin/main', 'main'])
    symlink(APP, '/srv/equiptags')
    run(user + ['/usr/local/bin/npm', 'ci', '--omit=dev'], cwd=APP)
    backups = DATA_ROOT / 'backups'
    backups.mkdir(exist_ok=True)
    run(['chown', 'equiptags:equiptags', str(backups)])
    backups.chmod(0o700)
    symlink(backups, '/srv/equiptags-backups')
    APP.chmod(0o750)
    marker.write_text(config['source_commit'] + '\n')


def configure_access(config):
    company = aws(config, 'ssm', 'get-parameter', '--name', config['company_parameter'])['Parameter']['Value']
    secret = aws(config, 'secretsmanager', 'get-secret-value', '--secret-id', config['secret_id'], sensitive=True)
    credentials, created = initial_credentials(secret['SecretString'])
    if created:
        with tempfile.NamedTemporaryFile(mode='w', prefix='inventoryapp-codes-', delete=True) as output:
            json.dump(credentials, output)
            output.flush()
            aws(config, 'secretsmanager', 'put-secret-value', '--secret-id', config['secret_id'],
                '--secret-string', 'file://' + output.name, sensitive=True)
    protected_env('/etc/equiptags.env', {'NODE_ENV': 'production', 'PORT': '5002',
                  'EQUIPTAGS_COMPANY_NAME': company, 'EQUIPTAGS_EDIT_PIN': credentials['manager_pin'],
                  'EQUIPTAGS_MASTER_PIN': credentials['master_pin']})
    protected_env('/etc/equiptags-backup.env', {'BACKUP_S3_URI': 's3://' + config['bucket'] + '/inventory',
                  'AWS_DEFAULT_REGION': config['region']})


def install_services(config):
    for name in ('equiptags.service', 'equiptags-backup.service', 'equiptags-backup.timer'):
        shutil.copyfile(APP / 'deploy' / name, pathlib.Path('/etc/systemd/system') / name)
    shutil.copyfile(APP / 'deploy/equiptags-backup.sh', '/usr/local/bin/equiptags-backup')
    pathlib.Path('/usr/local/bin/equiptags-backup').chmod(0o755)
    for service in ('equiptags.service', 'equiptags-backup.service'):
        dropin = pathlib.Path('/etc/systemd/system') / (service + '.d')
        dropin.mkdir(exist_ok=True)
        (dropin / 'data-volume.conf').write_text('[Unit]\nRequiresMountsFor=/srv/inventory-data\n')
    nginx = (APP / 'deploy/nginx.conf').read_text().replace('equipment.example.com', config['domain'])
    pathlib.Path('/etc/nginx/sites-available/equiptags').write_text(nginx)
    target = pathlib.Path('/etc/nginx/sites-enabled/equiptags')
    if not target.exists():
        target.symlink_to('/etc/nginx/sites-available/equiptags')
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'equiptags'])
    run(['nginx', '-t'])
    run(['systemctl', 'enable', '--now', 'nginx'])
    run(['systemctl', 'reload', 'nginx'])
    # Canonical Ubuntu AMIs normally include this agent; ensure browser administration works.
    if shutil.which('snap'):
        if subprocess.run(['snap', 'list', 'amazon-ssm-agent'], capture_output=True).returncode:
            run(['snap', 'install', 'amazon-ssm-agent', '--classic'])
        run(['snap', 'start', '--enable', 'amazon-ssm-agent'])


def verify(config):
    print('Waiting for the hostname to point to this server...', flush=True)
    # Check public DNS, not only the VPC resolver: certificate validation must also see the record.
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline:
        answers = run(['dig', '+short', '@1.1.1.1', config['domain'], 'A'], timeout=30).splitlines()
        if config['elastic_ip'] in answers:
            break
        time.sleep(10)
    else:
        raise RuntimeError('DNS did not point to the Elastic IP within 30 minutes. Add the A record and retry.')
    print('Issuing HTTPS certificate...', flush=True)
    run(['certbot', '--nginx', '--non-interactive', '--agree-tos', '--email', config['email'],
         '-d', config['domain'], '--redirect', '--keep-until-expiring'], timeout=600)
    run(['curl', '-fsS', '--retry', '10', '--retry-connrefused', '--retry-delay', '3',
         'http://127.0.0.1:5002/health'])
    run(['curl', '-fsS', '--resolve', config['domain'] + ':443:127.0.0.1',
         'https://' + config['domain'] + '/equiptags-api/health'])
    if run(['sqlite3', str(APP / 'equiptags.db'), 'PRAGMA integrity_check;']) != 'ok':
        raise RuntimeError('Company database integrity check failed.')
    print('Verifying the first private S3 backup...', flush=True)
    run(['systemctl', 'start', 'equiptags-backup.service'])
    run(['systemctl', 'enable', '--now', 'equiptags-backup.timer'])
    print('HTTPS, database, and first backup are ready.', flush=True)


def main():
    os.umask(0o077)
    if os.geteuid() != 0:
        raise RuntimeError('The EC2 bootstrap must run as root through cloud-init.')
    config = json.loads(CONFIG.read_text())
    if not re.fullmatch('[a-f0-9]{40}', config['source_commit']):
        raise ValueError('An exact source commit is required.')
    print('Installing server software...', flush=True)
    run(['apt-get', 'update', '-o', 'Acquire::Retries=5'])
    run(['apt-get', 'install', '-y', 'git', 'curl', 'ca-certificates', 'xz-utils', 'unzip',
         'build-essential', 'python3', 'sqlite3', 'nginx', 'certbot', 'python3-certbot-nginx', 'dnsutils'])
    mount_data(config)
    with tempfile.TemporaryDirectory(prefix='inventoryapp-bootstrap-') as temporary:
        work = pathlib.Path(temporary)
        print('Installing Node.js and AWS CLI...', flush=True)
        install_node(work)
        install_cli(work)
    print('Installing the pinned application release...', flush=True)
    install_source(config)
    configure_access(config)
    install_services(config)
    verify(config)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Inventoryapp setup failed: ' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
