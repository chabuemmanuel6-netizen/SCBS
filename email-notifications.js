import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const port = Number(process.env.EMAIL_PORT || 587);

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  return transporter;
}

export async function sendCustomerLoginEmail(customer) {
  try {
    const mailer = getTransporter();

    if (!mailer) {
      console.log("[SCBS email] Not configured; notification skipped.");
      return false;
    }

    await mailer.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: customer.email,
      subject: "SCBS customer account sign-in",
      text:
        "Hello " + (customer.full_name || "SCBS customer") + ",\n\n" +
        "A successful sign-in to your SCBS customer account was recorded.\n\n" +
        "If this was you, no action is needed. If you do not recognize this activity, contact SCBS using its official contact details.\n\n" +
        "Sergio Chabu Business System (SCBS)"
    });

    console.log("[SCBS email] Login notification sent.");
    return true;
  } catch (error) {
    console.error("[SCBS email] Notification failed:", error.message);
    return false;
  }
}
