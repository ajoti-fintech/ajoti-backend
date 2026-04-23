import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/notifications',
})
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  // userId → Set of socketIds (one user can have multiple tabs/devices)
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) throw new Error('No token');

      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });

      const userId = payload.sub;
      client.data.userId = userId;

      // Register socket for this user
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)?.add(client.id);

      // Join a room named after the userId for easy targeting
      client.join(`user:${userId}`);

      this.logger.log(`Client connected: userId=${userId}, socketId=${client.id}`);
    } catch {
      this.logger.warn(`Unauthorized WebSocket connection — disconnecting ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      if (this.userSockets.get(userId)?.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    this.logger.log(`Client disconnected: socketId=${client.id}`);
  }

  // ─── Incoming Events from Client ──────────────────────────────────────────
  @SubscribeMessage('notification.mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationId: string },
  ) {
    const userId = client.data.userId;
    await this.notificationService.markAsRead(userId, data.notificationId);

    // Acknowledge back to the client
    client.emit('notification.marked_read', { notificationId: data.notificationId });

    // Update unread count for all user's tabs/devices
    const { count } = await this.notificationService.getUnreadCount(userId);
    this.server.to(`user:${userId}`).emit('notification.unread_count', { count });
  }

  @SubscribeMessage('notification.mark_all_read')
  async handleMarkAllRead(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    await this.notificationService.markAllAsRead(userId);

    this.server.to(`user:${userId}`).emit('notification.unread_count', { count: 0 });
  }

  @SubscribeMessage('notification.get_unread_count')
  async handleGetUnreadCount(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    const { count } = await this.notificationService.getUnreadCount(userId);
    client.emit('notification.unread_count', { count });
  }

  /**
   * Push a notification to all active connections for a user.
   * If the user has no active sockets, this is a no-op — they'll
   * fetch missed notifications via REST on next load.
   */
  pushToUser(userId: string, event: string, data: object) {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
