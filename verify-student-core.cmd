@echo off
setlocal enabledelayedexpansion

if not defined STUDENT_TEST_PASSWORD (
    set "STUDENT_TEST_PASSWORD=student123"
)

set "BASE_URL=http://localhost:5000"
set "LOGIN_URL=%BASE_URL%/api/login"
set "PROFILE_URL=%BASE_URL%/api/student/profile"
set "ACADEMICS_URL=%BASE_URL%/api/student/academics"

set "LOGIN_FILE=%TEMP%\khit_student_login_%RANDOM%.json"
set "PROFILE_FILE=%TEMP%\khit_student_profile_%RANDOM%.json"
set "ACADEMICS_FILE=%TEMP%\khit_student_academics_%RANDOM%.json"
set "LOGIN_STATUS_FILE=%TEMP%\khit_student_login_status_%RANDOM%.txt"
set "PROFILE_STATUS_FILE=%TEMP%\khit_student_profile_status_%RANDOM%.txt"
set "ACADEMICS_STATUS_FILE=%TEMP%\khit_student_academics_status_%RANDOM%.txt"

set "LOGIN_STATUS=FAIL"
set "TOKEN_STATUS=NOT FOUND"
set "JWT="
set "PROFILE_HTTP_STATUS=ERROR"
set "ACADEMICS_HTTP_STATUS=ERROR"

rem --- Login with the existing demo student credentials ---
curl -sS --show-error --output "%LOGIN_FILE%" --write-out "%%{http_code}" --request POST "%LOGIN_URL%" --header "Content-Type: application/json" --data-raw "{\"username\":\"student\",\"password\":\"!STUDENT_TEST_PASSWORD!\",\"role\":\"student\"}" > "%LOGIN_STATUS_FILE%"
set /p LOGIN_HTTP_STATUS=<"%LOGIN_STATUS_FILE%"

if "%LOGIN_HTTP_STATUS%"=="" set "LOGIN_HTTP_STATUS=ERROR"

if not "%LOGIN_HTTP_STATUS%"=="200" (
    echo LOGIN: FAIL
    echo TOKEN: NOT FOUND
    echo LOGIN_HTTP_STATUS: %LOGIN_HTTP_STATUS%
    exit /b 1
)

for /f "usebackq delims=" %%I in (`node -e "const fs=require('fs'); const p=process.argv[1]; try { const data = JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); if (data && data.token) { console.log(String(data.token)); } } catch (err) {}" "%LOGIN_FILE%" 2^>nul`) do set "JWT=%%I"

if not defined JWT (
    echo LOGIN: FAIL
    echo TOKEN: NOT FOUND
    echo SAFE_LOGIN_RESPONSE_JSON: {"status":"error","message":"missing token in login response"}
    exit /b 1
)

set "LOGIN_STATUS=PASS"
set "TOKEN_STATUS=FOUND"

rem --- GET student profile using the JWT ---
curl -sS --show-error --output "%PROFILE_FILE%" --write-out "%%{http_code}" --header "Authorization: Bearer !JWT!" "%PROFILE_URL%" > "%PROFILE_STATUS_FILE%"
set /p PROFILE_HTTP_STATUS=<"%PROFILE_STATUS_FILE%"

rem --- GET student academics using the JWT ---
curl -sS --show-error --output "%ACADEMICS_FILE%" --write-out "%%{http_code}" --header "Authorization: Bearer !JWT!" "%ACADEMICS_URL%" > "%ACADEMICS_STATUS_FILE%"
set /p ACADEMICS_HTTP_STATUS=<"%ACADEMICS_STATUS_FILE%"

echo LOGIN: !LOGIN_STATUS!
echo TOKEN: !TOKEN_STATUS!
echo PROFILE HTTP status: !PROFILE_HTTP_STATUS!
echo ACADEMICS HTTP status: !ACADEMICS_HTTP_STATUS!

echo PROFILE SAFE JSON:
node -e "const fs=require('fs'); const p=process.argv[1]; let obj={}; try { obj = JSON.parse(fs.readFileSync(p,'utf8') || '{}'); } catch (err) { console.log(JSON.stringify({ status: 'invalid_json' })); process.exit(0); } const safe = { status: obj.status || 'unknown' }; if (obj.message) safe.message = obj.message; if (obj.student) { safe.student = {}; for (const key of ['id','student_id','roll_number','full_name','department','year','section','email','mobile']) { if (obj.student[key] !== undefined && obj.student[key] !== null) safe.student[key] = obj.student[key]; } } if (Array.isArray(obj.subjects)) { safe.subjects = obj.subjects.slice(0, 8).map(s => { const result = {}; for (const key of ['id','code','name','department','year','semester','section']) { if (s[key] !== undefined && s[key] !== null) result[key] = s[key]; } return result; }); } console.log(JSON.stringify(safe));" "%PROFILE_FILE%"

echo ACADEMICS SAFE JSON:
node -e "const fs=require('fs'); const p=process.argv[1]; let obj={}; try { obj = JSON.parse(fs.readFileSync(p,'utf8') || '{}'); } catch (err) { console.log(JSON.stringify({ status: 'invalid_json' })); process.exit(0); } const safe = { status: obj.status || 'unknown' }; if (obj.message) safe.message = obj.message; if (Array.isArray(obj.subjects)) { safe.subjects = obj.subjects.slice(0, 8).map(s => { const result = {}; for (const key of ['id','code','name','department','year','semester','section']) { if (s[key] !== undefined && s[key] !== null) result[key] = s[key]; } return result; }); } console.log(JSON.stringify(safe));" "%ACADEMICS_FILE%"

if "%PROFILE_HTTP_STATUS%"=="200" if "%ACADEMICS_HTTP_STATUS%"=="200" (
    exit /b 0
)

exit /b 1
