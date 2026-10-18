# Deploying Pardes Guard

Two parts, deployed separately:

| Part | Where it runs | Guide |
|---|---|---|
| The live app (`frontend/`) | Firebase Hosting, with Firebase Authentication, Firestore and Firebase AI Logic | This page |
| The production API (`backend/`) | Cloud Run, with Gemini on Agent Platform, Firestore, Spanner Graph, Cloud KMS and the rest | [`infra/CLOUD_RUN.md`](../infra/CLOUD_RUN.md) |

The live app does not call the API, so either can be deployed without the other.

## Settings files

Three places hold settings. Only the first is needed for the live app.

| Where | Needed for | What goes in it |
|---|---|---|
| `frontend/.env.local` | The live app (Firebase) | The four Firebase web app values (step 4 below). Copy it from `frontend/.env.example`. |
| `backend/.env` | The API on your computer only | `LLM_BACKEND=auto` and a `GEMINI_API_KEY` from Google AI Studio; the rest can stay as in `backend/.env.example`. |
| Cloud Run | The deployed API | Nothing to type. `infra/deploy.sh` sets every value; Gemini, Firestore, Spanner and KMS use the service account (no keys); the two secrets are made by `infra/setup.sh` in Secret Manager. |

The AI switches by itself in both builds. The live app tries Gemini through Firebase AI Logic and,
when it is out of quota, unreachable or not set up, says so and carries on with the rules and the
typed form. The API does the same with `LLM_BACKEND=auto`: a paper Gemini could not read is marked
"could not be read just now", so its result is never green, and Gemini is tried again after
`AI_COOLDOWN_SECONDS`. `LLM_BACKEND=fake` is only for the tests.

What the live app uses from Firebase: Hosting, Authentication (Google sign-in; guests need no
account), Firestore, and AI Logic with the Agent Platform Gemini API. Hosting, Authentication and
Firestore stay within the free quotas; Gemini on Agent Platform is billed to the project's Cloud
Billing account (the Gemini Developer API would need its own prepaid balance in AI Studio, see
`DECISIONS.md`, entry 120). The app was built for the Spark plan, so it
uses no Cloud Storage (vault files stay on the phone), no Cloud Functions (case steps move when the app
opens) and no phone number (SMS) sign-in. The project is on Blaze because billing is linked for the
API on Cloud Run.

## Put the live app online

Follow the steps in order.

**1. Tools on your computer.** Node 22 (`node -v` should print `v22...`), then the Firebase CLI, then
sign in:

```bash
npm install -g firebase-tools
firebase login
```

**2. Billing.** The team's Firebase project is `pardes-ea3e1`. It has billing linked for the API on
Cloud Run, so the console shows "Blaze": keep it that way, and set the budget alert in
[`infra/CLOUD_RUN.md`](../infra/CLOUD_RUN.md) (step 2) before deploying anything.

**3. Switch on the Firebase services** at https://console.firebase.google.com:

- Open the project `pardes-ea3e1` (it exists already, with its web app registered).
- Authentication > Get started > Sign-in method > Google > Enable > choose a support email > Save.
- Firestore Database > Create database > pick a location near the users (for example `asia-south1`,
  Mumbai; it cannot be changed later) > Start in production mode. The real rules are deployed in step 6.
- AI Logic (left menu) > Get started > choose the **Agent Platform Gemini API** and finish every
  screen (leave AI monitoring off). If AI Logic is already set up: AI Logic > Settings > Agent
  Platform Gemini API > Enable required APIs.
- App Check > APIs > Firebase AI Logic must say **Unenforced**: the app does not send App Check
  tokens yet, so enforcement refuses every AI call ("Firebase App Check token is invalid").
- Project settings (gear icon) > General > Your apps > Add app > Web (`</>`) > any nickname > Register.

**4. Paste the web app's config.** Project settings > General > Your apps > your web app > SDK setup
and configuration > Config shows an object like `{ apiKey: "...", authDomain: "...", ... }`. Copy four
of its values into a new file `frontend/.env.local` (start from the example):

```bash
cd frontend
cp .env.example .env.local
```

| In the console's config | Line in `frontend/.env.local` |
|---|---|
| `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY=` |
| `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=` |
| `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID=` |
| `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID=` |

Leave `NEXT_PUBLIC_GROUNDING=off`. These values are public by design (they end up in the page);
`.env.local` is git-ignored anyway. Never put a service-account key anywhere in this repository. Do
not add website (HTTP referrer) restrictions to this API key: the site sends no `Referer` header
(`Referrer-Policy: no-referrer` in `firebase.json`), so a key restricted that way refuses every request.

**5. Point the CLI at the project** (once, from the repository root). This writes `.firebaserc`, which
git ignores:

```bash
firebase use --add      # pick pardes-ea3e1, and give it the alias "default"
```

(Or copy `.firebaserc.example` to `.firebaserc` and put the project id in it.)

**6. Build and deploy** (from the repository root):

```bash
cd frontend && npm ci && npm run build && cd ..
firebase deploy --only hosting,firestore:rules
```

The command prints the live link (`https://<project id>.web.app`). Put it in the links table at the top
of the README. The values in `.env.local` are built into the site, so after changing them, build and
deploy again.

Unzip a new version of the code into an empty folder, never over an older copy: files the new version
no longer has would stay behind and break the build. `npm run dev` and `npm run build` check for them
first and name them; `node scripts/check-stale.mjs --fix` (in `frontend/`) deletes them.

**7. Make yourself staff.** Open the live link and sign in once (More > Sign in > Google). Then, in
the Firebase console:

1. Authentication > Users: copy your User UID.
2. Firestore Database > Start collection. Collection ID: `roles`. Document ID: paste the UID.
3. Add a field named `role`, type string, value `admin`. Save.

Reload the app: More > Staff now opens the NGO console and Admin (the Staff section is hidden in
simple mode). Other NGO staff get the value `ngo`: they review reports and publish warnings, and only
an admin can replace the licensed list.

**8. Check that it works on the live link.** These have never run against Google, so this is the first
real test of each:

- [ ] More > Sign in > Google: you are signed in, and your journey is still there. Then sign out.
  This is the first thing to check: `firebase.json` sends `X-Frame-Options: DENY` on every page, and
  whether that also reaches Firebase's own sign-in helper pages (`/__/auth/...`) has not been tested.
  If the Google window closes at once or the console mentions a frame, delete the `X-Frame-Options`
  entry from `firebase.json` and run `firebase deploy --only hosting` again.
- [ ] Check > one of the samples: the result says AI read the paper and the stamp lands.
- [ ] Check > a photo of a printed test paper of your own (never a real person's document).
- [ ] Assistant: type a question about Saudi Arabia; links appear under the answer.
- [ ] Assistant > talk (allow the microphone): it answers out loud and the words appear on screen.
- [ ] Interview practice as Ayesha (UK student visa), by voice and by typing, then the feedback.
- [ ] A case: draft the letter with AI, approve it, open it in WhatsApp.
- [ ] Family view: share a case's code and open it in another browser without signing in.
- [ ] NGO console and Admin open for your account, and not for an account without a role.
- [ ] More > Save for use without internet, then airplane mode: Home, SOS and Cases still open.
- [ ] All of the above once on a cheap Android phone, in Urdu.

When something fails, note the screen, what you tapped, and any red message in the browser's console
(desktop Chrome: right-click > Inspect > Console).

**9. Updating.** After a change is pulled:

```bash
cd frontend && npm ci && npm run build && cd ..
firebase deploy --only hosting
```

If `firestore.rules` changed, run `firebase deploy --only firestore:rules` as well.

## The production API on Cloud Run

With billing on the project, the backend runs on Cloud Run with the real services it was written for:
Gemini on Gemini Enterprise Agent Platform, Firestore, a Spanner Graph free trial instance, Cloud KMS,
Sensitive Data Protection, Model Armor, Secret Manager and Cloud Scheduler. Everything is done from
Cloud Shell with two scripts, then checked end to end with `backend/app/scripts/live_check.py`, which
writes `backend/LIVE_CHECK.md`. Steps, costs and how to take it down: [`infra/CLOUD_RUN.md`](../infra/CLOUD_RUN.md).

The API was deployed on 17 October 2026 and its live check passed 13 of 13
([`backend/LIVE_CHECK.md`](../backend/LIVE_CHECK.md)). The README and the deck name a service of the
API only if that check, or the log check after it in `infra/CLOUD_RUN.md`, shows it working.
