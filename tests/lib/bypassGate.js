// SaaS build (REQUIRE_AUTH): every real screen sits behind sign-in +
// onboarding + an entitled subscription (see renderEntitlementGate() in
// app.js). Most existing tests care about the screens *behind* the gate, not
// the gate itself -- that's specifically what 18-auth-gate.test.js,
// 19-onboarding-wizard.test.js, and 20-subscription-paywall.test.js cover --
// so call this right after page.goto() to skip straight past it.
//
// Uses the same convention already established in this suite (e.g.
// 13-clients-cloud-reconcile.test.js): app.js is a classic script, so
// `setState` is a bare global reachable directly from page.evaluate().
// Represents a fully onboarded, subscribed tenant -- not just "signed in" --
// since DEFAULT_BUSINESS_PROFILE ships with empty placeholders (name,
// defaultAddress, etc.) that only get filled in by the onboarding wizard.
// Tests that care about a specific businessProfile field (services list,
// default address, ...) should pass an override for that field explicitly
// rather than relying on these exact values, since this shape may evolve.
// Several tests call this a second time after a page.reload() purely to get
// back past the gate (auth/onboarding/subscription state is in-memory only,
// so a reload always re-shows the gate) -- at that point businessProfile may
// already hold *real*, persisted values from an edit made earlier in the same
// test (e.g. a Settings change), which must NOT get clobbered back to the
// seed defaults below. So the seed only applies once, while the profile is
// still in its fresh/unonboarded state (empty name) -- every later call just
// flips the gate flags and leaves businessProfile alone.
async function bypassGate(page, overrides) {
  await page.waitForFunction(() => typeof setState === 'function');
  await page.evaluate((ov) => {
    const patch = Object.assign({
      cloudReady: true,
      cloudUser: 'test@example.com',
      awaitingOnboarding: false,
      subscription: { status: 'active' }
    }, ov);
    if (!patch.businessProfile && !state.businessProfile.name) {
      patch.businessProfile = Object.assign({}, state.businessProfile, {
        name: 'Test Business',
        defaultAddress: '123 Test St, Testville, ON A1A 1A1',
        // Several existing tests have hour-slot-index assumptions baked in
        // (e.g. "index 2 of an 11am-7pm day is 1pm") -- keep these hours so
        // that behavior stays consistent rather than updating every test.
        hoursStart: 11,
        hoursEnd: 19,
        onboarded: true
      });
    }
    setState(patch);
    // Mirrors what Actions.submitOnboarding does for a real tenant -- the
    // blank-form default address is only built once at boot (loadPersisted()),
    // so it needs an explicit refresh after businessProfile changes here too.
    state.form = emptyForm();
  }, overrides || {});
}

module.exports = { bypassGate };
