export function baseTemplate(title: string, body: string) {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f6f9fc;
          padding: 20px;
        }
        .container {
          max-width: 520px;
          margin: auto;
          background: #ffffff;
          padding: 30px;
          border-radius: 8px;
        }
        .footer {
          margin-top: 30px;
          font-size: 12px;
          color: #777;
          text-align: center;
        }
        .otp {
          font-size: 28px;
          font-weight: bold;
          letter-spacing: 6px;
          margin: 20px 0;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>${title}</h2>
        ${body}
        <div class="footer">
          © ${new Date().getFullYear()} Ajoti. All rights reserved.
        </div>
      </div>
    </body>
  </html>
  `;
}
