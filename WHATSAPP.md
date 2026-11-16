# WhatsApp automations

When a booking is marked **completed** (price + payment method entered), openbooker
sends the client a WhatsApp thank-you receipt automatically. Clients who have ticked
**"OK getting offers on WhatsApp"** also get a **one-time** invite to the business's
WhatsApp Channel. Asha does nothing extra.

```
Mark completed ──► Firestore users/{uid} ──► Cloud Function whatsappOnAppointmentCompleted
                                               ├─ thank_you_receipt   (everyone with a valid phone)
                                               └─ channel_invite_offers (consent = true, once ever)
```

Code: `functions/whatsapp.js` (trigger + sender), `functions/whatsapp-lib.js` (pure logic),
`functions/test/` (unit + trigger tests, `cd functions && npm test`).

## Why a Channel, not a group
Everyone in a WhatsApp *group* can see everyone's phone number, so a competitor could join
and copy the client list. A *Channel* is one-way (only the business posts) and followers'
numbers are not shown to the admin or to each other.

## Safety rules built in
- Marketing (the Channel invite) goes **only** to clients with `consent === true`, once per client.
- The receipt is transactional (confirms a service the client just paid for).
- Idempotent: each send claims `whatsappLog/{uid}__{apptId}__thanks` with an atomic `create()`,
  so replayed events or doc rewrites never double-send. A failed send is logged
  (`status: "failed"`) and **not** auto-retried, to avoid double-texting after an ambiguous error.
- The function never writes to `users/{uid}`, so it cannot retrigger itself.
- Numbers it cannot confidently turn into E.164 are skipped, not guessed.
- Canada's anti-spam law (CASL) expects express consent for promotional messages and an easy
  way to opt out. Every promo ends with "Reply STOP"; when a client says STOP, untick their
  "Promo OK" box in Clients. Have your own advisor confirm what applies to you.

## One-time setup
1. **Meta**: create a WhatsApp Business Account in Meta Business Manager and add the sending
   number. Check whether your account offers *coexistence* (use the number in the WhatsApp
   Business app **and** the API). If it does not, the API needs its own number, and a number
   cannot be in the app and the API at once. With coexistence on, WhatsApp *broadcast lists*
   stop working, which is another reason to use a Channel.
2. **Templates** (WhatsApp Manager -> Message templates, language `en`). Wait for approval.

   `thank_you_receipt` -- category **Utility**
   ```
   Hi {{1}}, thank you for visiting SAMakeovers today! Your {{2}} came to {{3}}, paid by {{4}}. See you next time!
   ```
   `channel_invite_offers` -- category **Marketing**
   ```
   Hi {{1}}, thanks for saying yes to updates from SAMakeovers! Follow our WhatsApp Channel for festive slots and new arrivals: {{2}} Reply STOP to opt out.
   ```
3. **Create the Channel** in the WhatsApp Business app (Updates tab -> + -> New channel) and copy its link.
4. **Token**: create a System User in Meta Business settings with `whatsapp_business_messaging`,
   generate a permanent token, then: `firebase functions:secrets:set WHATSAPP_TOKEN`
5. **Config doc** (Firebase console -> Firestore, collection `whatsappConfig`, document id =
   the business owner's Auth UID):
   ```
   enabled: true
   phoneNumberId: "<from WhatsApp Manager -> API setup>"
   channelUrl: "https://whatsapp.com/channel/..."
   currency: "$"
   defaultCountryCode: "1"
   lang: "en"
   ```
6. **Deploy**: `firebase deploy --only functions,firestore:rules`
7. **Test**: add a booking with your own phone, tick "OK getting offers", mark it completed with
   a price. You should get the receipt, then the Channel invite. Check `whatsappLog` in Firestore.

## Cost
Each automated message is billed per message by Meta (utility vs marketing rates differ, and
some messages that used to be free became billable on Oct 1, 2026). Check the current
Canada/North America rate card before launch.
