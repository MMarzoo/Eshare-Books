import eventEmitter from 'node:events';
import { sendEmail, userDeletedDueToReportsTemplate } from '../utils/email.services.js';

export const sendEmailEvent = new eventEmitter();

sendEmailEvent.on('confirmEmail', async (data) => {
  try {
    sendEmail({ to: data.to, subject: data.subject || 'Confirm Email', html: data.html });
    console.log(`success to send ${data.to}`);
  } catch (error) {
    console.log('Can not send email to', data.to);
  }
});

sendEmailEvent.on('resetPassword', async (data) => {
  try {
    sendEmail({ to: data.to, subject: data.subject || 'Reset Password', html: data.html });
    console.log(`success to send ${data.to}`);
  } catch (error) {
    console.log('Can not send email to', data.to);
  }
});

// ✅ إضافة حدث جديد لحذف المستخدم بسبب 3 تقارير
sendEmailEvent.on('userDeletedDueToReports', async (data) => {
  try {
    const { userEmail, userName } = data;

    const htmlContent = userDeletedDueToReportsTemplate(userName);

    sendEmail({
      to: userEmail,
      subject: 'Account Deletion Notice - Esharebook',
      html: htmlContent,
    });

    console.log(`✅ Deletion notification sent to ${userEmail}`);
  } catch (error) {
    console.log('❌ Cannot send deletion email to', data.userEmail, error);
  }
});
