# Easy AWS deployment

Create a new company's complete installation from your browser. The guided installer creates the server, network, encrypted company disk, HTTPS website, initial PINs, and daily private S3 backups. Your existing installation is untouched.

## What you need

- An AWS account with permission to create CloudFormation, EC2/VPC/EBS, IAM roles, S3, Secrets Manager, and Systems Manager resources, and permission to use CloudShell. Route 53 permissions are needed for automatic DNS. Use your administrative AWS identity; the installer uses its existing CloudShell login and never asks for access keys.
- An unused hostname on a registered domain you control, such as `equipment.yourcompany.com`, and an email address for certificate notices. The installer does not register a domain.
- A Region with CloudShell, Canonical's Ubuntu 24.04 public AMI parameter, and t3.small instances. Start with **us-east-1** unless you have another preference.

AWS charges apply for the server, its disks, IPv4 address, secret, backups, and DNS if applicable. This setup uses a t3.small instance, a 16 GiB root disk, and a separate 30 GiB company disk. Review the current prices in your Region before confirming. It does not assume free-tier eligibility or set a spending cap.

## 1. Open AWS CloudShell

Sign in to the AWS account that should own the installation. Select your Region, then click the CloudShell terminal icon in the console's top bar, or use this link:

[Open AWS CloudShell in us-east-1](https://us-east-1.console.aws.amazon.com/cloudshell/home?region=us-east-1)

Wait for the browser terminal to appear. Use the standard CloudShell environment with public internet access, rather than a private VPC CloudShell environment.

## 2. Paste this command

```bash
curl -fsSL https://raw.githubusercontent.com/robbyweeds/Inventoryapp/main/deploy/aws/install.py -o /tmp/inventoryapp-install.py && python3 /tmp/inventoryapp-install.py
```

The command downloads the repository's installer as a file, then runs it with Python. You can inspect the downloaded file before running the second command if desired. No software installation on your computer, SSH key, or manual server setup is required.

Answer the short prompts:

| Prompt | What to enter |
| --- | --- |
| Company name | The name to display in the app |
| Website hostname | An unused hostname you control, e.g. `equipment.yourcompany.com` |
| Certificate email | Your email for HTTPS certificate notices |
| Installation name | Press Enter to accept the suggested name |
| Automatic DNS | Accept if the detected public Route 53 zone is authoritative for your domain |
| Create confirmation | Check the AWS account/Region and type `CREATE` |

The wizard validates the template with AWS, resolves an exact Git commit, and creates one CloudFormation stack. The confirmation is the point where billable AWS resources are created. Cancelling before that confirmation creates no infrastructure.

**If your domain is in Route 53:** the installer can create its A record automatically. A public hosted zone must already be authoritative for the domain; if the domain was registered elsewhere, delegate its nameservers to Route 53 first. Creating a zone alone does not change the domain's nameservers.

**If your DNS is elsewhere:** the installer displays `ADD DNS NOW` and the server's public IP. Add an **A record** for the chosen hostname at that DNS provider, pointing to the displayed IP. Leave the installer running while DNS updates. Remove any stale AAAA record if IPv6 is not configured. No other server work is required.

## 3. Open your website

Setup normally takes about 10–25 minutes; DNS or package-download delays can extend it. The process waits for DNS, obtains the HTTPS certificate, verifies the app/database, and completes the first S3 backup before reporting **READY**.

At the end it shows:

- Website URL.
- Admin URL.
- Initial PIN secret in Secrets Manager, with an option to show the initial PINs in your private CloudShell terminal.
- Server console link and backup bucket.

Open Admin with the generated admin PIN and create divisions. Then sign out, open the main app, and use **Staff sign in** with the generated manager PIN. Add crews, trailers, and equipment. **Mechanic queue → Division setup** configures categories and service defaults. The new company starts with no equipment or preset named divisions.

The initial PINs are stored as `master_pin` and `manager_pin` in the stack's Secrets Manager secret. Use the stack's **Outputs → CredentialsSecretArn** to find it and choose **Retrieve secret value**. After changing PINs through the app's Admin page, use the new saved PINs; the initial secret is not synchronized with later changes.

## If the terminal closes

The AWS deployment continues. Reopen CloudShell in the same Region and run:

```bash
curl -fsSL https://raw.githubusercontent.com/robbyweeds/Inventoryapp/main/deploy/aws/install.py -o /tmp/inventoryapp-install.py
python3 /tmp/inventoryapp-install.py --resume YOUR_INSTALLATION_NAME --region us-east-1
```

Replace the name/Region with those shown by the original installer. Resume only checks the existing installation and displays its results; it never creates another server. It does not repair a failed stack automatically. Do not create a second stack just because the terminal disconnected.

## What the installer does

- Creates a dedicated public VPC/subnet, internet route, and stable Elastic IP.
- Opens only ports 80 and 443. Administration uses **EC2 → Connect → Session Manager**; no public SSH port or SSH key is created.
- Installs the exact source commit resolved when setup starts, Node.js 24, Nginx, systemd services, and HTTPS renewal.
- Stores application files, database, and local backups on a separate encrypted EBS data volume. The app and backup service require that volume to be mounted.
- Generates distinct four-digit admin/manager PINs on the server. PINs never appear in EC2 user data or template outputs.
- Creates a private, versioned, encrypted S3 bucket and an upload-only backup permission for the server.
- Starts the daily verified backup timer and tests its first upload.
- Enables CloudFormation stack deletion protection. Company data volume, S3 bucket, and initial secret also have retention policies.

This is a single-server deployment with an independent local SQLite database. It does not create RDS or multi-server autoscaling. The app's normal public viewing/reporting and PIN-protected staff permissions are unchanged.

## Maintenance, recovery, and costs

**Server administration:** Open the instance link, choose **Connect → Session Manager**, and use `sudo` for protected commands. Initial setup logs are in `/var/log/cloud-init-output.log`; service logs use `sudo journalctl -u equiptags` and `sudo journalctl -u equiptags-backup.service`. The temporary bootstrap configuration contains a signed readiness URL: do not share that file publicly.

**Updates:** The source checkout is `/srv/equiptags` on the `main` branch, with an exact commit initially installed. Use README Part C's backup-first application update instructions. The guided installer is for fresh installations; do not rerun it as an upgrade or change CloudFormation parameters to replace a production instance. Application PIN rotation happens in Admin, not by editing the initial secret.

**Storage:** `/srv/equiptags` points to `/srv/inventory-data/app`; `/srv/equiptags-backups` points to `/srv/inventory-data/backups`. The separate data volume is mounted by UUID. Do not format a retained volume during recovery. Capture the stack outputs, source commit, and configuration in private handover notes.

**Backups:** The timer runs around 02:00 UTC each day. Inspect the S3 `inventory/` prefix and service journal regularly. The installer does not configure email alerts, a budget, or automatic local/S3 backup expiry; configure retention and monitoring appropriate to the company. Backups contain readable access records. The EC2 role uploads only; your recovery administrator needs separate S3 read permissions. Master-deletion-specific snapshots remain local, while the routine full database copies go to S3.

**Failure:** The wizard preserves failed-stack resources for troubleshooting instead of automatically deleting them. They can still incur charges. Open **CloudFormation → your installation → Events** for the failed resource and use Session Manager to inspect server logs. Correct DNS/access/quota issues before retrying through the AWS Console's supported failed-stack recovery process. A failed readiness wait does not mean the database was deleted. Resume reports status but does not turn a failed stack into a successful one.

**Deleting:** Deletion protection prevents accidental stack removal. To retire an installation, first make and verify a recoverable backup, stop the app/backup services and stop the EC2 instance so its data volume can detach cleanly, then explicitly turn off stack termination protection in the CloudFormation console and delete the stack. The company volume, S3 bucket, and initial secret remain and can continue to incur charges; retire those separately only when their data is no longer needed. Check retained resources and remove/update DNS records when retiring the public IP.

**Restoring:** Follow the detailed recovery instructions in README Part C. The guided installation's separate data volume can also be attached to a replacement instance in the same Availability Zone; preserve it, mount its existing filesystem, and restore matching service configuration. Do not start a replacement with an empty database while intending to recover the original company. Stop services before replacing database files or handling WAL/SHM sidecars.

## Advanced: use the template directly

`cloudformation.json` can be uploaded to **CloudFormation → Create stack → With new resources**. Supply a 40-character Inventoryapp source commit containing these installer files, an Availability Zone in the selected Region, company/hostname/email, and optionally the public hosted zone ID. Review the resource plan and acknowledge IAM-role creation. Enable termination protection and preserve resources on setup failure. The guided CloudShell path fills these values and tracks readiness for you.

The template is below CloudFormation's 51,200-byte inline-body limit, so the wizard needs no public S3 template-hosting bucket or published AWS credentials.

## Validation

CI checks the template with `cfn-lint` and exercises installer cancellation, creation, resume, DNS guidance, readiness failure, credential reuse, checksum failure, and disk protection using mocks. It also runs the app's regression suite and packages tracked source only. These checks do not launch billable AWS resources; a real AWS launch is still required to verify the target account's IAM permissions, quotas, domain, and certificate issuance.

References: [CloudShell](https://docs.aws.amazon.com/cloudshell/latest/userguide/getting-started.html), [Canonical Ubuntu AMI parameters](https://documentation.ubuntu.com/aws/aws-how-to/instances/build-cloudformation-templates/), [CloudFormation readiness signals](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-waitcondition.html), and [Secrets Manager](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html).
