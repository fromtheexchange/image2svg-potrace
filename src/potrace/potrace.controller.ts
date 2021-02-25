import { UseInterceptors, UploadedFiles } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Controller, Post } from '@nestjs/common';
import { PotraceService, ColorMode } from './potrace.service';

@Controller('potrace')
export class PotraceController {
  constructor(private readonly potraceService: PotraceService) {}

  @Post('color')
  @UseInterceptors(AnyFilesInterceptor())
  // File type https://stackoverflow.com/a/59325829
  async color(@UploadedFiles() files: Express.Multer.File[]) {
    const colorMode = ColorMode.COLOR;

    const processedFiles = await this.potraceService.processFiles(
      files,
      colorMode,
    );

    return {
      algorithm: 'potrace',
      colorMode,
      files: processedFiles,
    };
  }

  @Post('black-and-white')
  @UseInterceptors(AnyFilesInterceptor())
  // File type https://stackoverflow.com/a/59325829
  async blackandwhite(@UploadedFiles() files: Express.Multer.File[]) {
    const colorMode = ColorMode.BLACK_AND_WHITE;

    const processedFiles = await this.potraceService.processFiles(
      files,
      colorMode,
    );

    return {
      algorithm: 'potrace',
      colorMode,
      files: processedFiles,
    };
  }
}
