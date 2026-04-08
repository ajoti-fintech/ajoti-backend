import { baseTemplate } from './base';

export function transactionTemplate(
  fullName: string,
  type: 'CREDIT' | 'DEBIT',
  amount: number,
  currency: string,
  reference: string,
) {
  let body = '';

  if (type === 'CREDIT') {
    body = `
      <h2 class="greeting">You Received Money 💰</h2>
      <p class="message">
        Hi ${fullName}, you have received ${currency} ${amount.toLocaleString()} from a transaction with reference number: ${reference}.
        If you did not authorize this transaction, please contact our support team immediately.
      </p>
    `;
  }

  if (type === 'DEBIT') {
    body = `
      <h2 class="greeting">You Made a Payment 📤</h2>
      <p class="message">
        Hi ${fullName}, you have made a payment of ${currency} ${amount.toLocaleString} with reference number: ${reference}.
        If you did not make this payment, our support team is here to help!
      </p>
    `;
  }
  return baseTemplate(body);
}
