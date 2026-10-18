import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaModule } from '../media/media.module';
import { ProgressPhotosController } from './progress-photos.controller';
import { ProgressPhotosService } from './progress-photos.service';
import { ProgressPhoto, ProgressPhotoSchema } from './schemas/progress-photo.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProgressPhoto.name, schema: ProgressPhotoSchema }]),
    MediaModule,
  ],
  controllers: [ProgressPhotosController],
  providers: [ProgressPhotosService],
})
export class ProgressPhotosModule {}
