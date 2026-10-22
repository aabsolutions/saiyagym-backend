import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaModule } from '../media/media.module';
import { UsersModule } from '../users/users.module';
import { AdminSoundsController } from './admin-sounds.controller';
import { RestSound, RestSoundSchema } from './schemas/rest-sound.schema';
import { SoundsController } from './sounds.controller';
import { SoundsService } from './sounds.service';

/** Admin-managed rest-alarm sound library (audio in Cloudinary, premium-gated per sound). */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: RestSound.name, schema: RestSoundSchema }]),
    UsersModule,
    MediaModule,
  ],
  controllers: [SoundsController, AdminSoundsController],
  providers: [SoundsService],
})
export class SoundsModule {}
