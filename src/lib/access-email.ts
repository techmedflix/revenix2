import { Resend } from 'resend'

export async function sendAccessRequestEmail(input: {
  requesterEmail: string
  requesterName?: string | null
}) {
  if (!process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM || 'noreply@medflix.app'
  const adminEmail = process.env.RESEND_ADMIN_EMAIL || 'rohan@medflix.app'

  const name = input.requesterName?.trim() || input.requesterEmail.split('@')[0]

  try {
    await resend.emails.send({
      from,
      to: [adminEmail, 'chirag@medflix.app'],
      subject: `MedOS access request: ${input.requesterEmail}`,
      html: `
        <div style="font-family:Arial,sans-serif;">
          <h2>MedOS Access Approval Required</h2>
          <p>A user signed in and is awaiting approval.</p>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${input.requesterEmail}</p>
        </div>
      `,
    })
  } catch (error) {
    console.error('Failed to send access email', error)
  }
}
