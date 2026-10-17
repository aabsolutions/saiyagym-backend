import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { Role, ROLES } from '../../../common/constants/role';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';

export const SEXES = ['male', 'female', 'other'] as const;
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const GOALS = ['hypertrophy', 'powerlifting', 'both'] as const;
export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;
export const THEMES = ['system', 'light', 'dark'] as const;
export const SUBSCRIPTION_STATUSES = ['active', 'canceled', 'expired'] as const;
export const SUBSCRIPTION_PROVIDERS = ['manual', 'stripe', 'revenuecat'] as const;

export type Sex = (typeof SEXES)[number];
export type Level = (typeof LEVELS)[number];
export type Goal = (typeof GOALS)[number];
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];
export type Theme = (typeof THEMES)[number];
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number];

@Schema({ _id: false })
export class UserProfile {
  @Prop({ type: String, default: null, trim: true, maxlength: 80 }) name!: string | null;
  @Prop({ type: Date, default: null }) birthDate!: Date | null;
  @Prop({ type: String, enum: [...SEXES, null], default: null }) sex!: Sex | null;
  /** Always stored in cm (SPEC: units are presentation-only). */
  @Prop({ type: Number, default: null, min: 50, max: 272 }) heightCm!: number | null;
  @Prop({ type: String, enum: [...LEVELS, null], default: null }) level!: Level | null;
  @Prop({ type: String, enum: [...GOALS, null], default: null }) goal!: Goal | null;
}

@Schema({ _id: false })
export class UserPreferences {
  @Prop({ type: String, enum: UNIT_SYSTEMS, default: 'metric' }) units!: UnitSystem;
  /** UI + email language. Any code with a src/i18n/<lang> folder; falls back to `es`. */
  @Prop({ type: String, default: 'es' }) language!: string;
  @Prop({ type: String, enum: THEMES, default: 'system' }) theme!: Theme;
  @Prop({ type: Number, default: 120, min: 0, max: 1800 }) defaultRestSeconds!: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  @Prop({ type: Number, default: 1, min: 1, max: 7 }) firstDayOfWeek!: number;
}

@Schema({ _id: false })
export class UserSubscription {
  @Prop({ type: String, default: null }) planId!: string | null;
  @Prop({ type: String, enum: SUBSCRIPTION_STATUSES, default: 'active' })
  status!: SubscriptionStatus;
  /** null = no expiry (manual assignment / default plan). */
  @Prop({ type: Date, default: null }) currentPeriodEnd!: Date | null;
  @Prop({ type: String, enum: SUBSCRIPTION_PROVIDERS, default: 'manual' })
  provider!: SubscriptionProvider;
}

@Schema({ ...baseSchemaOptions, collection: 'users' })
export class User extends BaseSchema {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  /** argon2id hash. Never selected by default — use `.select('+passwordHash')`. */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, enum: ROLES, default: Role.USER, index: true })
  role!: Role;

  @Prop({ type: Date, default: null })
  emailVerifiedAt!: Date | null;

  @Prop({ type: SchemaFactory.createForClass(UserProfile), default: () => ({}) })
  profile!: UserProfile;

  @Prop({ type: SchemaFactory.createForClass(UserPreferences), default: () => ({}) })
  preferences!: UserPreferences;

  @Prop({ type: SchemaFactory.createForClass(UserSubscription), default: () => ({}) })
  subscription!: UserSubscription;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
