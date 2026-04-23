// import { Test, TestingModule } from '@nestjs/testing';
// import { BadRequestException } from '@nestjs/common';
// import { WebhooksController } from './webhooks.controller';
// import { WebhooksService } from './webhooks.service';
// import { FlutterwaveService } from '../transactions/flutterwave.service';
// import { TransactionsService } from '../transactions/transactions.service';
// import { createHmac } from 'crypto';

// describe('WebhooksController', () => {
//   let controller: WebhooksController;
//   let webhooksService: WebhooksService;
//   let flutterwaveService: FlutterwaveService;
//   let transactionsService: TransactionsService;

//   const mockWebhooksService = {
//     recordWebhook: jest.fn(),
//     processFundingWebhook: jest.fn(),
//   };

//   const mockFlutterwaveService = {
//     verifyWebhook: jest.fn(),
//   };

//   const mockTransactionsService = {
//     finalizeSettlement: jest.fn(),
//     markAsFailed: jest.fn(),
//   };

//   beforeEach(async () => {
//     const module: TestingModule = await Test.createTestingModule({
//       controllers: [WebhooksController],
//       providers: [
//         {
//           provide: WebhooksService,
//           useValue: mockWebhooksService,
//         },
//         {
//           provide: FlutterwaveService,
//           useValue: mockFlutterwaveService,
//         },
//         {
//           provide: TransactionsService,
//           useValue: mockTransactionsService,
//         },
//       ],
//     }).compile();

//     controller = module.get<WebhooksController>(WebhooksController);
//     webhooksService = module.get<WebhooksService>(WebhooksService);
//     flutterwaveService = module.get<FlutterwaveService>(FlutterwaveService);
//     transactionsService = module.get<TransactionsService>(TransactionsService);
//   });

//   afterEach(() => {
//     jest.clearAllMocks();
//   });

//   describe('handleFlutterwave', () => {
//     const validPayload = {
//       event: 'charge.completed',
//       data: {
//         id: 123456,
//         tx_ref: 'AJT-FUND-123',
//         amount: 1000,
//         currency: 'NGN',
//         status: 'successful',
//         customer: {
//           email: 'test@example.com',
//         },
//       },
//     };

//     it('should process valid webhook with correct signature', async () => {
//       const rawBody = JSON.stringify(validPayload);
//       const signature = createHmac('sha256', 'test-secret')
//         .update(rawBody)
//         .digest('base64');

//       const mockRequest: any = {
//         rawBody: Buffer.from(rawBody),
//       };

//       mockFlutterwaveService.verifyWebhook.mockReturnValue({
//         valid: true,
//         payload: validPayload,
//       });
//       mockWebhooksService.recordWebhook.mockResolvedValue({ id: 'webhook-1' });
//       mockTransactionsService.finalizeSettlement.mockResolvedValue({
//         status: 'success',
//       });

//       const result = await controller.handleFlutterwave(
//         signature,
//         mockRequest,
//         validPayload as any,
//       );

//       expect(result.status).toBe('success');
//       expect(mockFlutterwaveService.verifyWebhook).toHaveBeenCalledWith(
//         rawBody,
//         signature,
//       );
//       expect(mockWebhooksService.recordWebhook).toHaveBeenCalledWith(
//         'FLUTTERWAVE',
//         validPayload.data.id,
//         validPayload,
//       );
//       expect(mockTransactionsService.finalizeSettlement).toHaveBeenCalledWith({
//         reference: validPayload.data.tx_ref,
//         providerId: String(validPayload.data.id),
//         receivedAmountNaira: validPayload.data.amount,
//         providerName: 'FLUTTERWAVE',
//         webhookPayload: validPayload,
//       });
//     });

//     it('should reject webhook with invalid signature', async () => {
//       const rawBody = JSON.stringify(validPayload);
//       const invalidSignature = 'invalid-signature';

//       const mockRequest: any = {
//         rawBody: Buffer.from(rawBody),
//       };

//       mockFlutterwaveService.verifyWebhook.mockReturnValue({
//         valid: false,
//         reason: 'HMAC mismatch',
//       });

//       const result = await controller.handleFlutterwave(
//         invalidSignature,
//         mockRequest,
//         validPayload as any,
//       );

//       expect(result.status).toBe('ignored');
//       expect(result.reason).toBe('signature_mismatch');
//       expect(mockWebhooksService.recordWebhook).not.toHaveBeenCalled();
//     });

//     it('should throw error when signature header is missing', async () => {
//       const mockRequest: any = {
//         rawBody: Buffer.from(JSON.stringify(validPayload)),
//       };

//       await expect(
//         controller.handleFlutterwave(undefined as any, mockRequest, validPayload as any),
//       ).rejects.toThrow(BadRequestException);
//     });

//     it('should handle duplicate webhooks', async () => {
//       const rawBody = JSON.stringify(validPayload);
//       const signature = createHmac('sha256', 'test-secret')
//         .update(rawBody)
//         .digest('base64');

//       const mockRequest: any = {
//         rawBody: Buffer.from(rawBody),
//       };

//       mockFlutterwaveService.verifyWebhook.mockReturnValue({
//         valid: true,
//         payload: validPayload,
//       });
//       mockWebhooksService.recordWebhook.mockResolvedValue(null); // Duplicate

//       const result = await controller.handleFlutterwave(
//         signature,
//         mockRequest,
//         validPayload as any,
//       );

//       expect(result.status).toBe('already_processed');
//       expect(mockTransactionsService.finalizeSettlement).not.toHaveBeenCalled();
//     });

//     it('should handle failed payment webhooks', async () => {
//       const failedPayload = {
//         ...validPayload,
//         data: {
//           ...validPayload.data,
//           status: 'failed',
//         },
//       };

//       const rawBody = JSON.stringify(failedPayload);
//       const signature = createHmac('sha256', 'test-secret')
//         .update(rawBody)
//         .digest('base64');

//       const mockRequest: any = {
//         rawBody: Buffer.from(rawBody),
//       };

//       mockFlutterwaveService.verifyWebhook.mockReturnValue({
//         valid: true,
//         payload: failedPayload,
//       });
//       mockWebhooksService.recordWebhook.mockResolvedValue({ id: 'webhook-1' });

//       await controller.handleFlutterwave(
//         signature,
//         mockRequest,
//         failedPayload as any,
//       );

//       expect(mockTransactionsService.markAsFailed).toHaveBeenCalledWith(
//         failedPayload.data.tx_ref,
//         expect.stringContaining('failed'),
//       );
//     });

//     it('should log unhandled event types', async () => {
//       const unknownPayload = {
//         event: 'transfer.completed',
//         data: {
//           id: 123456,
//           tx_ref: 'TRANSFER-123',
//         },
//       };

//       const rawBody = JSON.stringify(unknownPayload);
//       const signature = createHmac('sha256', 'test-secret')
//         .update(rawBody)
//         .digest('base64');

//       const mockRequest: any = {
//         rawBody: Buffer.from(rawBody),
//       };

//       mockFlutterwaveService.verifyWebhook.mockReturnValue({
//         valid: true,
//         payload: unknownPayload,
//       });
//       mockWebhooksService.recordWebhook.mockResolvedValue({ id: 'webhook-1' });

//       const result = await controller.handleFlutterwave(
//         signature,
//         mockRequest,
//         unknownPayload as any,
//       );

//       expect(result.status).toBe('success');
//     });

//     it('should handle errors gracefully', async () => {
//       const rawBody = JSON.stringify(validPayload);
//       const signature = createHmac('sha256', 'test-secret')
//         .update(rawBody)
//         .digest('base64');

//       const mockRequest: any = {
//         rawBody: Buffer.from(rawBody),
//       };

//       mockFlutterwaveService.verifyWebhook.mockReturnValue({
//         valid: true,
//         payload: validPayload,
//       });
//       mockWebhooksService.recordWebhook.mockRejectedValue(
//         new Error('Database error'),
//       );

//       const result = await controller.handleFlutterwave(
//         signature,
//         mockRequest,
//         validPayload as any,
//       );

//       expect(result.status).toBe('error');
//     });
//   });
// });
