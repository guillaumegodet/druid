// Transactional e-mails of the Functions (druid-internal docs/plan-druid-saas.md, lot 1 e): the templates live in
// lib/saas/email.ts, shared with the runner; secrets RESEND_API_KEY and EMAIL_FROM of the deployment.
export { sendEmail, sendMagicLink, sendTenantReady } from '../../lib/saas/email.ts';
