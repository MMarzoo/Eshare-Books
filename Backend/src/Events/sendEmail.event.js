import eventEmitter from 'node:events';
import {
  sendEmail,
  userDeletedDueToReportsTemplate,
  userDeletedByAdminTemplate,
  userConfirmedTemplate,
} from '../utils/email.services.js';

export const sendEmailEvent = new eventEmitter();

sendEmailEvent.on('confirmEmail', async (data) => {
  try {
    sendEmail({ to: data.to, subject: data.subject || 'Confirm Email', html: data.html });
    console.log(`✅ Email sent to ${data.to}`);
  } catch (error) {
    console.log('❌ Cannot send email to', data.to);
  }
});

sendEmailEvent.on('resetPassword', async (data) => {
  try {
    sendEmail({ to: data.to, subject: data.subject || 'Reset Password', html: data.html });
    console.log(`✅ Reset password email sent to ${data.to}`);
  } catch (error) {
    console.log('❌ Cannot send reset password email to', data.to);
  }
});

sendEmailEvent.on('userDeletedDueToReports', async (data) => {
  try {
    const { userEmail, userName } = data;

    const htmlContent = userDeletedDueToReportsTemplate(userName);

    await sendEmail({
      to: userEmail,
      subject: 'Account Deletion Notice - Esharebook',
      html: htmlContent,
    });

    console.log(`✅ Auto-deletion notification sent to ${userEmail}`);
  } catch (error) {
    console.log('❌ Cannot send auto-deletion email to', data.userEmail, error);
  }
});

sendEmailEvent.on('userDeletedByAdmin', async (data) => {
  try {
    const { userEmail, userName, reason } = data;

    const htmlContent = userDeletedByAdminTemplate(userName, reason || 'policy violations');

    await sendEmail({
      to: userEmail,
      subject: 'Account Deletion Notice - Esharebook',
      html: htmlContent,
    });

    console.log(`✅ Admin deletion email sent to ${userEmail} (without admin name)`);
  } catch (error) {
    console.log('❌ Cannot send admin deletion email to', data.userEmail, error);
  }
});

sendEmailEvent.on('userConfirmedByAdmin', async (data) => {
  try {
    const { userEmail, userName } = data;

    const htmlContent = userConfirmedTemplate(userName);

    await sendEmail({
      to: userEmail,
      subject: 'Account Confirmed - Esharebook',
      html: htmlContent,
    });

    console.log(`✅ User confirmation email sent to ${userEmail}`);
  } catch (error) {
    console.log('❌ Cannot send confirmation email to', data.userEmail, error);
  }
});
