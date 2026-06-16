// Welcome-email delivery via Resend. When RESEND_API_KEY is unset/placeholder
// (or EMAIL_SERVICE is not 'resend'), we degrade to a log-only stub so the
// webhook + registration flow still work end-to-end in development. The buyer
// is already provisioned by the caller, so a stubbed/failed email is recoverable
// via the admin "resend" feature.

import { Resend } from 'resend';

const RESEND_PLACEHOLDER = 'PASTE_YOUR_RESEND_API_KEY_HERE';
const apiKey = process.env.RESEND_API_KEY;
const service = (process.env.EMAIL_SERVICE || 'resend').toLowerCase();
const fromAddress = process.env.EMAIL_FROM || 'noreply@tinmanmetalworks.com';
const appUrl = process.env.APP_URL || 'http://localhost:5173';

const resendConfigured = Boolean(
  service === 'resend' && apiKey && apiKey !== RESEND_PLACEHOLDER
);

const resend = resendConfigured ? new Resend(apiKey) : null;

const SUBJECT = 'Your Tin Man Metal Works Sales Mentor 3.0 is Ready!';

function buildPlainText({ firstName, licenseKey, email }) {
  const name = firstName || 'there';
  return `Hi ${name},

Welcome to the Tin Man Metal Works Sales Mentor 3.0! Your purchase is complete and your account is ready to activate.

Here's your license key:

    ${licenseKey}

To activate your account:

  1. Go to ${appUrl}
  2. Enter the email address you used to purchase: ${email}
  3. Enter your license key: ${licenseKey}
  4. Create your password

That's it — you'll be coaching like a pro in no time.

If you have any trouble activating, just reply to this email and we'll get you sorted.

To your success,

Charles Woten
Tin Man Metal Works`;
}

function buildHtml({ firstName, licenseKey, email }) {
  const name = firstName || 'there';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e8e8e8;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <div style="background:#242424;border-radius:12px;padding:32px;border:1px solid #2f2f2f;">
        <h1 style="margin:0 0 16px;font-size:22px;color:#00E676;">Your Sales Mentor 3.0 is Ready!</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${name},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          Welcome to the Tin Man Metal Works Sales Mentor 3.0! Your purchase is complete and your account is ready to activate.
        </p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">Here's your license key:</p>
        <div style="background:#1a1a1a;border:1px solid #00C853;border-radius:8px;padding:16px;text-align:center;margin:0 0 24px;">
          <span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:20px;letter-spacing:2px;color:#00E676;font-weight:600;">${licenseKey}</span>
        </div>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">To activate your account:</p>
        <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.8;">
          <li>Go to <a href="${appUrl}" style="color:#00E676;">${appUrl}</a></li>
          <li>Enter the email address you used to purchase: <strong>${email}</strong></li>
          <li>Enter your license key: <strong>${licenseKey}</strong></li>
          <li>Create your password</li>
        </ol>
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${appUrl}" style="display:inline-block;background:#00C853;color:#0a0a0a;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:8px;font-size:15px;">Activate My Account</a>
        </div>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          That's it — you'll be coaching like a pro in no time. If you have any trouble activating, just reply to this email and we'll get you sorted.
        </p>
        <p style="margin:24px 0 0;font-size:15px;line-height:1.6;">
          To your success,<br/>
          <strong>Charles Woten</strong><br/>
          Tin Man Metal Works
        </p>
      </div>
    </div>
  </body>
</html>`;
}

export async function sendWelcomeEmail({ email, firstName, licenseKey }) {
  if (!resendConfigured) {
    console.log(
      `[email:stub] would send welcome email to ${email} ` +
        `(name=${firstName || '—'}, key=${licenseKey}). Set RESEND_API_KEY to enable real delivery.`
    );
    return { ok: true, stub: true };
  }

  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: email,
    subject: SUBJECT,
    text: buildPlainText({ firstName, licenseKey, email }),
    html: buildHtml({ firstName, licenseKey, email }),
  });

  if (error) {
    throw new Error(error.message || 'Resend delivery failed');
  }
  return { ok: true, id: data?.id };
}
