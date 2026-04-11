import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

interface JwtPayload {
  sub: string;
  role: 'MEMBER' | 'ADMIN' | 'SUPERADMIN';
}

interface User {
  userId: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly usersService: UsersService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.usersService.findAuthUserById(payload.sub);
    if (!user || !user.isVerified) {
      throw new UnauthorizedException();
    }
    return { userId: user.id, role: user.role };
  }
}
