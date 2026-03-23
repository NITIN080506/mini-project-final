export async function signInWithGooglePopup({
  supabase,
  redirectTo,
  timeoutMs = 180000,
}) {
  if (!supabase?.auth) {
    throw new Error('Authentication is still loading. Please try again in a moment.');
  }

  const callbackUrl = new URL('/auth/popup-callback', redirectTo).toString();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl,
      skipBrowserRedirect: true,
      queryParams: {
        prompt: 'select_account',
      },
    },
  });

  if (error) throw error;
  if (!data?.url) {
    throw new Error('Failed to start Google sign-in.');
  }

  const width = 520;
  const height = 700;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  const popup = window.open(
    data.url,
    'eduflow_google_oauth',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  if (!popup) {
    throw new Error('Popup was blocked. Allow popups for this site and try again.');
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let checking = false;
    let finished = false;

    const messageHandler = async (event) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data || {};

      if (payload.type === 'eduflow:oauth:error') {
        finishReject(new Error(payload.message || 'Google sign-in failed.'));
        return;
      }

      if (payload.type !== 'eduflow:oauth:success') return;

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;
        if (!session?.user) {
          throw new Error('Google sign-in completed but no active session was found.');
        }

        finishResolve(session.user);
      } catch (err) {
        finishReject(err);
      }
    };

    const finishResolve = (user) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        popup.close();
      } catch {
        // ignore
      }
      resolve(user);
    };

    const finishReject = (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        popup.close();
      } catch {
        // ignore
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const { data: authData } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session?.user) return;
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        finishResolve(session.user);
      }
    });
    const subscription = authData?.subscription;

    const cleanup = () => {
      clearInterval(interval);
      window.removeEventListener('message', messageHandler);
      try {
        subscription?.unsubscribe();
      } catch {
        // ignore
      }
    };

    window.addEventListener('message', messageHandler);

    const interval = setInterval(async () => {
      if (finished) return;
      if (checking) return;
      checking = true;

      try {
        const elapsed = Date.now() - startedAt;
        if (elapsed > timeoutMs) {
          finishReject(new Error('Google sign-in timed out. Please try again.'));
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          finishResolve(session.user);
          return;
        }
      } catch (err) {
        finishReject(err);
      } finally {
        checking = false;
      }
    }, 500);
  });
}
