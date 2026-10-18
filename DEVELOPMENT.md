# Development and release

Use Node.js 24 and `npm ci`. Copy `.env.example` to `.env`, set a company name and distinct four-digit initial PINs, then run `node --env-file=.env server.js`.

Run `npm test` before deployment. Tests use isolated temporary databases; historical migration tests explicitly enable legacy division fixtures. Fresh-install tests verify an empty company and new division ticket numbering. Never point test/seed tools at a production API.

`main` is the deployment branch. Take a consistent SQLite backup and record the source commit before updates. Stop the service before changing source or restoring a database. Use matching code/database versions for a schema rollback. Never commit company databases, `.env`, or private backups.

See README Parts A, B, and C for workflows, implementation, deployment, and recovery. This distribution has no dependency on another company's Apache, PM2, source checkout, database, or deployment switch.

AWS server creation, public networking, DNS, private S3 storage/IAM, scheduled backups, and disaster recovery are documented end to end in README Part C. Backup tests need Bash and the sqlite3 CLI; the CI job installs sqlite3. The backup script uses the EC2 instance role and does not provision AWS resources itself.

Guided AWS deployment lives in `deploy/aws/`. `install.py` runs in CloudShell; `cloudformation.json` creates the infrastructure; `bootstrap.py` runs as root on the new EC2 instance only. Run `python3 -m unittest discover -s deploy/aws/tests -v` and `cfn-lint deploy/aws/cloudformation.json` after changing these files. CloudFormation retains company data/backups/initial secret and waits for HTTPS plus the first backup. CI uses mocks/schema checks and does not create paid AWS infrastructure.

The guided installer now defaults to an AWS-assigned CloudFront HTTPS hostname. Empty DomainName/CertificateEmail selects automatic hosting; a custom domain remains optional. CloudFront forwards all API methods/headers/cookies/query strings with cache TTLs zero. Its origin uses an AWS prefix-list restriction plus a private secret header. The bootstrap verifies the origin and first backup before signaling ready; the CloudShell wizard verifies the public HTTPS site after distribution deployment. Preserve the distribution to keep NFC/QR hostnames during recovery.

The real origin proxy integration test needs Nginx; CI installs it. Locally, set `INVENTORYAPP_TEST_NGINX` to an isolated nginx binary if the server does not have one. The test starts only a temporary unprivileged listener and never changes the live Apache configuration.

Editor access has been retired. Startup converts saved Editor roles to Manager without changing PINs, IDs, timestamps, or historical audits. New bootstrap access is Manager, and staff creation/role changes accept only Manager and Mechanic. Crew members view and report without PINs.
