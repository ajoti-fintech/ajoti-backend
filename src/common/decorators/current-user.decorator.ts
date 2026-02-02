import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator to extract current user from request
 * Assumes authentication middleware has attached user to request
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
