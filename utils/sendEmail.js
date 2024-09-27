const { Resend } = require("resend");

const sendEmail = async (options) => {
  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: options.email,
      subject: options.subject,
      html: "<h1>Test</h1>",
    };
  
    const data = await resend.emails.send(mailOptions);
    
    if(data.error) {
      console.log("Error sending email:", data.error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.log("Error sending email:", error);
    return false;
  }
};

module.exports = sendEmail;
