import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlansModule } from '../plans/plans.module';
import { RestSoundRegistry } from './rest-sound.registry';
import { User, UserSchema } from './schemas/user.schema';
import { AdminUsersController, MeController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), PlansModule],
  controllers: [MeController, AdminUsersController],
  providers: [UsersService, RestSoundRegistry],
  exports: [UsersService, RestSoundRegistry],
})
export class UsersModule {}
