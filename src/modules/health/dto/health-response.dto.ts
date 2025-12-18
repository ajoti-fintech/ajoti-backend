export class HealthResponseDto {
  status: 'ok' | 'error';
  timestamp: string;
  service: string;
  version: string;
}
