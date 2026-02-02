import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests. Please try again later.') {
    super({ message, error: 'TOO_MANY_REQUEST' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
