import { Module } from '@nestjs/common';
import { PotraceModule } from '../potrace/potrace.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [PotraceModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
