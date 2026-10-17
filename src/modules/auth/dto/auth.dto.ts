import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { LANGUAGE_CODE, MeDto } from '../../users/dto/user.dto';

/** 8+ chars; the 128 cap bounds argon2 work (DoS via huge passwords). No composition rules (NIST 800-63B). */
const PasswordRules = () => applyDecorators(IsString(), MinLength(8), MaxLength(128));

const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export class RegisterDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @PasswordRules()
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  /** UI/email language. Defaults to the request's Accept-Language. */
  @IsOptional()
  @Matches(LANGUAGE_CODE)
  language?: string;
}

export class LoginDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** Only bounded, not policy-checked: old passwords may predate the current rules. */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  refreshToken!: string;
}

export class TokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;
}

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @PasswordRules()
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @PasswordRules()
  newPassword!: string;
}

export class DeleteAccountDto {
  /** Re-authentication: a stolen access token alone can't delete the account. */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class TokenPairDto {
  accessToken!: string;
  /** Opaque, single-use. Send it to /auth/refresh to get a new pair. */
  refreshToken!: string;
  tokenType!: 'Bearer';
  /** Access-token lifetime in seconds. */
  expiresIn!: number;
  refreshTokenExpiresAt!: Date;
}

export class AuthResponseDto {
  tokens!: TokenPairDto;
  user!: MeDto;
}
