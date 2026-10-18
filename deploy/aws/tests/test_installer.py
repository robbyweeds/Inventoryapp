import contextlib
import importlib.util
import io
import json
import pathlib
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


install = module('installer', ROOT / 'install.py')
bootstrap = module('bootstrap', ROOT / 'bootstrap.py')
TEMPLATE = json.loads((ROOT / 'cloudformation.json').read_text())


class InstallerTests(unittest.TestCase):
    def test_cancel_does_not_create_resources(self):
        calls = []
        def api(region, *args):
            calls.append(args)
            if args[0] == 'sts': return {'Account': '123456789012'}
            if args[1] == 'list-stacks': return {'StackSummaries': []}
            if args[1] == 'describe-availability-zones': return {'AvailabilityZones': [{'ZoneName': 'us-east-1a'}]}
            if args[1] == 'describe-instance-type-offerings': return {'InstanceTypeOfferings': [{'Location': 'us-east-1a'}]}
            raise AssertionError(args)
        answers = ['Example Landscaping', 'equipment.example.com', 'owner@example.com', '', 'cancel']
        with patch.object(install, 'aws', side_effect=api), patch.object(install, 'public_zone', return_value='Z123'), \
             patch.object(install, 'source_release', return_value=('a' * 40, TEMPLATE)), \
             patch('sys.argv', ['install.py']), patch('builtins.input', side_effect=answers), contextlib.redirect_stdout(io.StringIO()):
            install.main()
        self.assertFalse(any('create-stack' in call for call in calls))

    def test_create_pins_exact_source_and_protects_the_stack(self):
        calls = []
        def api(region, *args):
            calls.append(args)
            if args[0] == 'sts': return {'Account': '123456789012'}
            if args[1] == 'list-stacks': return {'StackSummaries': []}
            if args[1] == 'describe-availability-zones': return {'AvailabilityZones': [{'ZoneName': 'us-east-1a'}]}
            if args[1] == 'describe-instance-type-offerings': return {'InstanceTypeOfferings': [{'Location': 'us-east-1a'}]}
            if args[1] == 'validate-template': return {}
            if args[1] == 'create-stack':
                params = json.loads(pathlib.Path(args[args.index('--parameters') + 1][7:]).read_text())
                self.assertIn({'ParameterKey': 'SourceCommit', 'ParameterValue': 'a' * 40}, params)
                self.assertIn('--enable-termination-protection', args)
                self.assertIn('--disable-rollback', args)
                self.assertIn('CAPABILITY_IAM', args)
                return {'StackId': 'test-stack'}
            raise AssertionError(args)
        with patch.object(install, 'aws', side_effect=api), patch.object(install, 'public_zone', return_value='Z123'), \
             patch.object(install, 'source_release', return_value=('a' * 40, TEMPLATE)), \
             patch.object(install, 'progress', return_value={'ready': True}) as progress, \
             patch.object(install, 'show_result') as result, patch('sys.argv', ['install.py']), \
             patch('builtins.input', side_effect=['Example Landscaping', 'equipment.example.com', 'owner@example.com', '', 'CREATE']), \
             contextlib.redirect_stdout(io.StringIO()):
            install.main()
            progress.assert_called_once()
            result.assert_called_once()
        self.assertEqual(sum('create-stack' in call for call in calls), 1)

    def test_resume_never_creates_a_stack(self):
        description = {'Parameters': [{'ParameterKey': 'DomainName', 'ParameterValue': 'equipment.example.com'},
                                     {'ParameterKey': 'HostedZoneId', 'ParameterValue': ''}]}
        with patch('sys.argv', ['install.py', '--resume', 'existing']), \
             patch.object(install, 'aws', return_value={'Account': '123456789012'}) as api, \
             patch.object(install, 'outputs', return_value=(description, {})), \
             patch.object(install, 'progress', return_value={}), patch.object(install, 'show_result'), \
             contextlib.redirect_stdout(io.StringIO()):
            install.main()
        self.assertFalse(any('create-stack' in call.args for call in api.call_args_list))

    def test_failed_bootstrap_is_never_reported_ready(self):
        with patch.object(install, 'outputs', return_value=({'StackStatus': 'CREATE_FAILED'}, {})), \
             patch.object(install, 'aws', return_value={'StackResources': [], 'StackEvents': [
                 {'LogicalResourceId': 'Ready', 'ResourceStatus': 'CREATE_FAILED', 'ResourceStatusReason': 'Bootstrap failed'}]}), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(install.InstallError, 'did not finish'):
                install.progress('us-east-1', 'example', 'equipment.example.com', True)

    def test_external_dns_instruction_and_success_outputs(self):
        states = [({'StackStatus': 'CREATE_IN_PROGRESS'}, {}), ({'StackStatus': 'CREATE_COMPLETE'}, {'Website': 'https://equipment.example.com/equiptags/'})]
        def api(region, *args):
            if args[1] == 'describe-stack-resources':
                return {'StackResources': [{'LogicalResourceId': 'PublicIp', 'PhysicalResourceId': 'eipalloc-example'}]}
            return {'Addresses': [{'PublicIp': '192.0.2.10'}]}
        output = io.StringIO()
        with patch.object(install, 'outputs', side_effect=states), patch.object(install, 'aws', side_effect=api), \
             patch.object(install.time, 'sleep'), contextlib.redirect_stdout(output):
            result = install.progress('us-east-1', 'example', 'equipment.example.com', False)
        self.assertIn('ADD DNS NOW: A record equipment.example.com -> 192.0.2.10', output.getvalue())
        self.assertIn('Website', result)

    def test_private_zones_and_parent_suffix_lookalikes_are_not_selected(self):
        zones = [{'Name': 'example.com.', 'Id': '/hostedzone/ZPRIVATE', 'Config': {'PrivateZone': True}},
                 {'Name': 'ample.com.', 'Id': '/hostedzone/ZWRONG', 'Config': {'PrivateZone': False}},
                 {'Name': 'example.com.', 'Id': '/hostedzone/ZPUBLIC', 'Config': {'PrivateZone': False}}]
        with patch.object(install, 'aws', return_value={'HostedZones': zones}), patch('builtins.input', return_value=''), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(install.public_zone('us-east-1', 'equipment.example.com'), 'ZPUBLIC')


class BootstrapTests(unittest.TestCase):
    def test_initial_pins_distinct_and_retry_reuses_saved_credentials(self):
        with patch.object(bootstrap.secrets, 'randbelow', side_effect=[42, 42, 91]):
            codes, changed = bootstrap.initial_credentials('a-random-seed')
        self.assertEqual(codes, {'master_pin': '0042', 'manager_pin': '0091'})
        self.assertTrue(changed)
        self.assertEqual(bootstrap.initial_credentials(json.dumps(codes)), (codes, False))
        with self.assertRaises(ValueError): bootstrap.initial_credentials('{"unexpected":"data"}')

    def test_configuration_quotes_names_and_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'environment'
            bootstrap.protected_env(path, {'COMPANY': 'O\'Brien "Landscaping" $test', 'PIN': '0042'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertIn('PIN="0042"', path.read_text())
            self.assertIn('\\"Landscaping\\"', path.read_text())

    def test_exact_volume_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for device, serial in [('nvme0n1', 'vol-rootdisk'), ('nvme1n1', 'vol-companydata')]:
                target = root / device / 'device'
                target.mkdir(parents=True)
                (target / 'serial').write_text(serial)
            self.assertEqual(bootstrap.data_device('vol-companydata', root), '/dev/nvme1n1')
            self.assertIsNone(bootstrap.data_device('vol-missing', root))

    def test_existing_unknown_filesystem_is_never_formatted(self):
        with patch.object(bootstrap, 'data_device', return_value='/dev/fake'), \
             patch.object(bootstrap.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'xfs\n', '')), \
             patch.object(bootstrap, 'run') as run, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'refusing to change'):
                bootstrap.mount_data({'volume_id': 'vol-example'})
            run.assert_not_called()

    def test_sensitive_command_errors_do_not_print_secret_stderr(self):
        with patch.object(bootstrap.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'secret-pin-0042')):
            with self.assertRaises(RuntimeError) as result:
                bootstrap.run(['aws', 'secret-operation'], sensitive=True)
            self.assertNotIn('0042', str(result.exception))

    def test_node_checksum_mismatch_stops_before_installation(self):
        def download(url, target):
            target.write_bytes(b'bad archive' if url.endswith('.xz') else b'0' * 64 + b'  node-v24.22.0-linux-x64.tar.xz\n')
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'download', side_effect=download), \
             patch.object(bootstrap, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                bootstrap.install_node(pathlib.Path(directory))
            run.assert_not_called()


class TemplateTests(unittest.TestCase):
    def test_retention_ports_no_ssh_and_no_pin_userdata(self):
        resources = TEMPLATE['Resources']
        for name in ['DataVolume', 'Backups', 'Credentials']:
            self.assertEqual(resources[name]['DeletionPolicy'], 'Retain')
            self.assertEqual(resources[name]['UpdateReplacePolicy'], 'Retain')
        self.assertTrue(resources['DataVolume']['Properties']['Encrypted'])
        rules = resources['WebSecurityGroup']['Properties']['SecurityGroupIngress']
        self.assertEqual({rule['FromPort'] for rule in rules}, {80, 443})
        self.assertEqual(resources['Server']['Properties']['MetadataOptions']['HttpTokens'], 'required')
        data = resources['Server']['Properties']['UserData']['Fn::Base64']['Fn::Sub']
        self.assertNotIn('master_pin', data)
        self.assertNotIn('manager_pin', data)
        self.assertNotIn('set -x', data)
        self.assertEqual(subprocess.run(['bash', '-n'], input=data, text=True, capture_output=True).returncode, 0)
        self.assertEqual(set(resources['Ready']['DependsOn']), {'IpAssociation', 'VolumeAttachment'})
        self.assertNotIn('Ready', resources['Server'].get('DependsOn', []))
        self.assertLess(len(json.dumps(TEMPLATE).encode()), 51200)

    def test_parameter_rules_accept_normal_names_and_reject_injection(self):
        rules = TEMPLATE['Parameters']
        for key, value in [('CompanyName', 'Example Landscaping'), ('DomainName', 'equipment.example.com'),
                           ('CertificateEmail', 'owner+equipment@example.com'), ('SourceCommit', 'a' * 40)]:
            self.assertIsNotNone(re.fullmatch(rules[key]['AllowedPattern'], value), key)
        for value in ['example.com\"\nmalicious', '$(touch bad).example.com', '-bad.example.com']:
            self.assertIsNone(re.fullmatch(rules['DomainName']['AllowedPattern'], value))
        self.assertIsNone(re.fullmatch(rules['CompanyName']['AllowedPattern'], 'Line1\nLine2'))


if __name__ == '__main__':
    unittest.main()
