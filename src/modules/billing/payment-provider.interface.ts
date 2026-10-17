/**
 * Payment gateway abstraction — NOT IMPLEMENTED in this version (SPEC: admins assign plans
 * manually via PUT /admin/users/:id/subscription). This file only fixes the contract so
 * adding a gateway later doesn't reshape the domain.
 *
 * Planned implementations
 * -----------------------
 * - `StripePaymentProvider` (web): Checkout Session for purchase, Customer Portal for
 *   management, webhooks `checkout.session.completed`, `customer.subscription.updated|deleted`,
 *   `invoice.payment_failed`. `externalCustomerId` = Stripe customer id.
 * - `RevenueCatPaymentProvider` (mobile in-app purchases): purchases happen client-side via the
 *   RevenueCat SDK using our user id as `app_user_id`; the API only consumes RevenueCat webhooks
 *   (`INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, …). `createCheckout` is
 *   therefore not supported by this provider.
 *
 * Integration rules
 * -----------------
 * - Webhooks are the source of truth: they map to `user.subscription`
 *   `{ planId, status, currentPeriodEnd, provider }` — nothing else changes plan access.
 * - Always verify webhook signatures and make handling idempotent (store processed event ids).
 * - Map gateway products/prices to our `plans.code`, never to plan `_id` (ids differ per env).
 * - Entitlements keep being resolved by PlansService.resolveEffectivePlan; a provider never
 *   decides access on its own.
 */
export interface PaymentProvider {
  /** Matches `user.subscription.provider`. */
  readonly id: 'stripe' | 'revenuecat';

  /** Start a purchase for `planCode` and return a URL to redirect the user to (web flows). */
  createCheckout(params: {
    userId: string;
    planCode: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;

  /** URL where the user manages/cancels their subscription. */
  createManagementLink(params: { userId: string; returnUrl: string }): Promise<{ url: string }>;

  /**
   * Verify and translate a raw webhook into a subscription change. Returns `null` for events
   * that don't affect access. Must throw on an invalid signature.
   */
  parseWebhook(params: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<SubscriptionChange | null>;
}

export interface SubscriptionChange {
  /** Gateway event id, for idempotency. */
  eventId: string;
  userId: string;
  planCode: string;
  status: 'active' | 'canceled' | 'expired';
  currentPeriodEnd: Date | null;
}

/** DI token, for when implementations exist: `@Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[]`. */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
