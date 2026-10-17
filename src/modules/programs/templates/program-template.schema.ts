import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { ProgressionRule } from '../../../common/constants/training';
import type { Translatable } from '../../../common/utils/translatable.util';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';
import { RoutineSet } from '../../routines/schemas/routine.schema';
import { ProgramDeload } from '../schemas/program.schema';

export const TEMPLATE_GOALS = ['hypertrophy', 'powerlifting', 'both'] as const;
export type TemplateGoal = (typeof TEMPLATE_GOALS)[number];
export const TEMPLATE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type TemplateLevel = (typeof TEMPLATE_LEVELS)[number];

@Schema({ _id: false })
export class TemplateExercise {
  /** Global exercise slug — ids differ per environment, slugs don't. */
  @Prop({ required: true }) exerciseSlug!: string;
  @Prop({ type: String, default: null }) groupId!: string | null;
  @Prop({ type: String, default: '' }) notes!: string;
  @Prop({ type: [SchemaFactory.createForClass(RoutineSet)], default: [] }) sets!: RoutineSet[];
  @Prop({ type: Object, default: null }) progression!: ProgressionRule | null;
}

@Schema({ _id: false })
export class TemplateRoutine {
  /** Referenced by weeks[].days[].routineKey. */
  @Prop({ required: true }) key!: string;
  @Prop({ type: Object, required: true }) name!: Translatable;
  @Prop({ type: [SchemaFactory.createForClass(TemplateExercise)], default: [] })
  exercises!: TemplateExercise[];
}

@Schema({ _id: false })
export class TemplateDay {
  @Prop({ required: true, min: 1, max: 7 }) weekday!: number;
  @Prop({ required: true }) routineKey!: string;
}

@Schema({ _id: false })
export class TemplateWeek {
  @Prop({ type: [SchemaFactory.createForClass(TemplateDay)], default: [] }) days!: TemplateDay[];
}

/** Global, admin-managed program blueprint. Users copy it into their own routines + program. */
@Schema({ ...baseSchemaOptions, collection: 'program_templates' })
export class ProgramTemplate extends BaseSchema {
  /** Kept on soft delete (stays reserved; the seed never resurrects it). */
  @Prop({ required: true, unique: true, lowercase: true, trim: true }) slug!: string;
  @Prop({ type: Object, required: true }) name!: Translatable;
  @Prop({ type: Object, default: () => ({}) }) description!: Translatable;
  @Prop({ type: String, enum: TEMPLATE_GOALS, required: true }) goal!: TemplateGoal;
  @Prop({ type: String, enum: TEMPLATE_LEVELS, required: true }) level!: TemplateLevel;
  @Prop({ required: true, min: 1, max: 52 }) durationWeeks!: number;
  @Prop({ type: [SchemaFactory.createForClass(TemplateRoutine)], default: [] })
  routines!: TemplateRoutine[];
  @Prop({ type: [SchemaFactory.createForClass(TemplateWeek)], default: [] }) weeks!: TemplateWeek[];
  @Prop({ type: SchemaFactory.createForClass(ProgramDeload), default: () => ({}) })
  deload!: ProgramDeload;
  /** Hidden from users when false. */
  @Prop({ default: true }) active!: boolean;
  @Prop({ default: 0 }) sortOrder!: number;
}

export type ProgramTemplateDocument = HydratedDocument<ProgramTemplate>;
export const ProgramTemplateSchema = SchemaFactory.createForClass(ProgramTemplate);
