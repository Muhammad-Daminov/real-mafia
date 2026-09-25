import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { TelegramReplayGuardService } from './telegram-replay-guard.service';
import { INIT_DATA_FRESHNESS_WINDOW_SECONDS } from './auth.constants';

@Injectable()
export class AuthService {
  constructor(
  private readonly prisma: PrismaService,
  private readonly jwtService: JwtService,
  private readonly replayGuard: TelegramReplayGuardService,
  ) {}

  async loginWithTelegram(initData: string) {
    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
      throw new Error('BOT_TOKEN is not configured');
    }

    const params = new URLSearchParams(initData);

    const receivedHash = params.get('hash');

    if (!receivedHash) {
      throw new BadRequestException('Telegram hash mavjud emas');
    }

    const authDate = params.get('auth_date');

    if (!authDate) {
      throw new BadRequestException('Telegram auth_date mavjud emas');
    }

    const authTimestamp = Number(authDate);
    const currentTimestamp = Math.floor(Date.now() / 1000);

    // initData 1 soatdan eski bo‘lmasin
    if (
      !Number.isFinite(authTimestamp) ||
      currentTimestamp - authTimestamp >
        INIT_DATA_FRESHNESS_WINDOW_SECONDS ||
      authTimestamp > currentTimestamp + 60
    ) {
      throw new BadRequestException('Telegram initData eskirgan');
    }

    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const receivedHashBuffer = Buffer.from(receivedHash, 'hex');
    const calculatedHashBuffer = Buffer.from(calculatedHash, 'hex');

    if (
      receivedHashBuffer.length !== calculatedHashBuffer.length ||
      !timingSafeEqual(receivedHashBuffer, calculatedHashBuffer)
    ) {
      throw new BadRequestException('Telegram initData noto‘g‘ri');
    }

    // Replay guard runs only after the HMAC proves the payload is genuinely
    // Telegram's, so unauthenticated garbage can never fill the store.
    const expiresAt = new Date(
      (authTimestamp + INIT_DATA_FRESHNESS_WINDOW_SECONDS) * 1000,
    );

    const isFirstUse = await this.replayGuard.claim(receivedHash, expiresAt);

    if (!isFirstUse) {
      throw new BadRequestException(
        'Telegram initData allaqachon ishlatilgan',
      );
    }

    const userData = params.get('user');

    if (!userData) {
      throw new BadRequestException(
        'Telegram user maʼlumoti topilmadi',
      );
    }

    let telegramUser: {
      id: number;
      username?: string;
      first_name: string;
      last_name?: string;
      photo_url?: string;
    };

    try {
      telegramUser = JSON.parse(userData);
    } catch {
      throw new BadRequestException(
        'Telegram user maʼlumoti noto‘g‘ri',
      );
    }

    const user = await this.prisma.user.upsert({
      where: {
        telegramId: String(telegramUser.id),
      },

      update: {
        username: telegramUser.username,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        avatar: telegramUser.photo_url,
      },

      create: {
        telegramId: String(telegramUser.id),
        username: telegramUser.username,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        avatar: telegramUser.photo_url,
      },
    });

  const accessToken = await this.jwtService.signAsync({
  sub: user.id,
  telegramId: user.telegramId,
});

return {
  accessToken,
  user,
};
  }
}