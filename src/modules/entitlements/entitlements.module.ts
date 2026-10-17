import { Global, Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { UsersModule } from '../users/users.module';
import { EntitlementsGuard } from './entitlements.guard';
import { EntitlementsService } from './entitlements.service';
import { UsageCountersRegistry } from './usage-counters.registry';

/** Global so any domain module can inject UsageCountersRegistry / EntitlementsService. */
@Global()
@Module({
  imports: [UsersModule, PlansModule],
  providers: [EntitlementsService, UsageCountersRegistry, EntitlementsGuard],
  exports: [EntitlementsService, UsageCountersRegistry, EntitlementsGuard],
})
export class EntitlementsModule {}
