// base.ts
export function baseTemplate(body: string) {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        /* Base styles */
        body {
          font-family: Arial, Helvetica, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #f6f9fc;
          color: #333;
          line-height: 1.6;
        }
        
        .email-container {
          max-width: 600px;
          margin: 20px auto;
          background-color: #ffffff;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        
        /* Header with gradient */
        .header {
          background: linear-gradient(to right, #153D31, #10B981);
          padding: 30px 20px;
          text-align: center;
        }
        
        .logo {
          color: #FFFFFF;
          font-size: 28px;
          font-weight: bold;
          text-decoration: none;
          display: inline-block;
          margin-bottom: 10px;
        }
        
        .logo-icon {
          display: inline-block;
          width: 40px;
          height: 40px;
          background-color: #FFD700;
          border-radius: 8px;
          margin-right: 10px;
          vertical-align: middle;
          position: relative;
        }
        
        .logo-icon:after {
          content: "A";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-weight: bold;
          color: #153D31;
          font-size: 20px;
        }
        
        .tagline {
          color: rgba(255, 255, 255, 0.85);
          font-size: 14px;
          margin-top: 5px;
        }
        
        /* Content */
        .content {
          padding: 40px 30px;
        }
        
        .greeting {
          color: #066F5B;
          font-size: 20px;
          margin-bottom: 25px;
          font-weight: 600;
        }
        
        .message {
          color: #444;
          margin-bottom: 30px;
          font-size: 15px;
        }
        
        /* OTP Box */
        .otp-container {
          background-color: #f8fdfb;
          border-radius: 10px;
          padding: 25px;
          margin: 30px 0;
          border: 1px solid #e1f5ed;
          text-align: center;
        }
        
        .otp-label {
          color: #066F5B;
          font-size: 14px;
          margin-bottom: 15px;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 600;
        }
        
        .otp-code {
          font-size: 42px;
          font-weight: 800;
          letter-spacing: 10px;
          color: #10B981;
          margin: 15px 0;
          font-family: 'Courier New', monospace;
          padding: 10px;
          background-color: white;
          border-radius: 8px;
          display: inline-block;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.15);
        }
        
        .otp-expiry {
          color: #777;
          font-size: 14px;
          margin-top: 10px;
        }
        
        .otp-expiry strong {
          color: #F81914;
        }
        
        /* Button */
        .btn-container {
          text-align: center;
          margin: 35px 0;
        }
        
        .verify-btn {
          display: inline-block;
          background: linear-gradient(to right, #066F5B, #00C853);
          color: white;
          text-decoration: none;
          padding: 16px 40px;
          border-radius: 50px;
          font-weight: bold;
          font-size: 16px;
          box-shadow: 0 4px 12px rgba(6, 111, 91, 0.2);
          transition: all 0.3s ease;
        }
        
        .verify-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(6, 111, 91, 0.3);
        }
        
        /* Instructions */
        .instructions {
          background-color: #fffcf2;
          border-left: 4px solid #FFD700;
          padding: 20px;
          margin: 30px 0;
          border-radius: 0 8px 8px 0;
        }
        
        .instructions h3 {
          color: #b8860b;
          margin-top: 0;
          font-size: 16px;
        }
        
        .instructions ul {
          padding-left: 20px;
          margin-bottom: 0;
        }
        
        .instructions li {
          margin-bottom: 8px;
          font-size: 14px;
        }
        
        /* Footer */
        .footer {
          background-color: #f8f9fa;
          padding: 25px 30px;
          text-align: center;
          border-top: 1px solid #eee;
          color: #777;
          font-size: 13px;
        }
        
        .footer-links {
          margin-bottom: 15px;
        }
        
        .footer-links a {
          color: #066F5B;
          text-decoration: none;
          margin: 0 10px;
          font-size: 13px;
        }
        
        .footer-links a:hover {
          text-decoration: underline;
        }
        
        .copyright {
          margin-top: 15px;
          color: #999;
          font-size: 12px;
        }
        
        .social-icons {
          margin: 20px 0;
        }
        
        .social-icon {
          display: inline-block;
          width: 32px;
          height: 32px;
          background-color: #10B981;
          border-radius: 50%;
          margin: 0 5px;
          text-align: center;
          line-height: 32px;
          color: white;
          font-size: 14px;
          text-decoration: none;
        }
        
        /* Responsive */
        @media (max-width: 600px) {
          .content {
            padding: 30px 20px;
          }
          
          .otp-code {
            font-size: 36px;
            letter-spacing: 8px;
          }
          
          .header {
            padding: 25px 15px;
          }
          
          .email-container {
            margin: 10px;
            border-radius: 8px;
          }
        }
        
        @media (max-width: 480px) {
          .otp-code {
            font-size: 32px;
            letter-spacing: 6px;
          }
          
          .verify-btn {
            padding: 14px 30px;
            font-size: 15px;
            display: block;
            margin: 0 10px;
          }
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <a href="https://ajoti.com" class="logo">
            <span class="logo-icon"></span>
            Ajoti
          </a>
          <div class="tagline">Secure & Reliable</div>
        </div>
        
        <div class="content">
          ${body}
          
          <div class="footer">
            <div class="social-icons">
              <a href="https://facebook.com/ajoti" class="social-icon">F</a>
              <a href="https://twitter.com/ajoti" class="social-icon">T</a>
              <a href="https://instagram.com/ajoti" class="social-icon">I</a>
              <a href="https://linkedin.com/company/ajoti" class="social-icon">L</a>
            </div>
            
            <div class="footer-links">
              <a href="https://ajoti.com/help">Help Center</a> | 
              <a href="https://ajoti.com/privacy">Privacy Policy</a> | 
              <a href="https://ajoti.com/terms">Terms of Service</a>
            </div>
            
            <div class="copyright">
              © ${new Date().getFullYear()} Ajoti. All rights reserved.<br>
              This is an automated email, please do not reply.
            </div>
          </div>
        </div>
      </div>
    </body>
  </html>
  `;
}
