const http = require('http');

const baseUrl = 'http://localhost:5000';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(baseUrl + path, requestOptions, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (error) {
          parsed = raw;
        }
        resolve({
          status: res.statusCode,
          body: parsed
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

(async () => {
  try {
    const login = await request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'student',
        password: 'student123',
        role: 'student'
      })
    });

    console.log('LOGIN_STATUS=' + login.status);

    if (login.status !== 200 || !login.body || !login.body.token) {
      throw new Error('Login failed: missing JWT');
    }

    const authHeaders = {
      Authorization: 'Bearer ' + login.body.token
    };

    const profile = await request('/api/student/profile', { headers: authHeaders });
    console.log('PROFILE_STATUS=' + profile.status);
    console.log('PROFILE_SUCCESS=' + (profile.body && profile.body.status === 'success'));
    console.log('PROFILE_ID=' + (profile.body && profile.body.student ? profile.body.student.id : 'missing'));

    if (profile.status !== 200 || !profile.body || profile.body.status !== 'success') {
      throw new Error('Profile request failed');
    }

    const academics = await request('/api/student/academics', { headers: authHeaders });
    console.log('ACADEMICS_STATUS=' + academics.status);
    console.log('ACADEMICS_SUCCESS=' + (academics.body && academics.body.status === 'success'));
    console.log('ACADEMICS_COUNT=' + (academics.body && Array.isArray(academics.body.subjects) ? academics.body.subjects.length : 'missing'));

    if (academics.status !== 200 || !academics.body || academics.body.status !== 'success') {
      throw new Error('Academics request failed');
    }

    const originalCity = profile.body.student && profile.body.student.city !== undefined && profile.body.student.city !== null
      ? String(profile.body.student.city)
      : '';

    const patch = await request('/api/student/profile', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + login.body.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ city: 'VERIFY_TMP' })
    });

    console.log('PATCH_STATUS=' + patch.status);
    console.log('PATCH_SUCCESS=' + (patch.body && patch.body.status === 'success'));

    const afterPatch = await request('/api/student/profile', { headers: authHeaders });
    console.log('PATCH_APPLIED=' + (afterPatch.body && afterPatch.body.student && afterPatch.body.student.city === 'VERIFY_TMP'));

    const restore = await request('/api/student/profile', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + login.body.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ city: originalCity })
    });

    console.log('RESTORE_STATUS=' + restore.status);
    console.log('RESTORE_SUCCESS=' + (restore.body && restore.body.status === 'success'));

    const afterRestore = await request('/api/student/profile', { headers: authHeaders });
    console.log('PATCH_RESTORED=' + (afterRestore.body && afterRestore.body.student && afterRestore.body.student.city === originalCity));

    if (!patch.body || patch.body.status !== 'success') {
      throw new Error('Patch request failed');
    }

    if (!restore.body || restore.body.status !== 'success') {
      throw new Error('Restore request failed');
    }

    console.log('VERIFICATION=PASS');
  } catch (error) {
    console.error('VERIFY_ERROR=' + error.message);
    process.exit(1);
  }
})();
