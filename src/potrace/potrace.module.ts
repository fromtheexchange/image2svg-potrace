import { Module } from '@nestjs/common';
import { PotraceController } from './potrace.controller';
import { PotraceService } from './potrace.service';

@Module({
  controllers: [PotraceController],
  providers: [PotraceService]
})
export class PotraceModule {}
