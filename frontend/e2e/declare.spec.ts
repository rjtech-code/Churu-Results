import { RO_STATE, expect, test, world } from './support';

test.use({ storageState: RO_STATE });

test('declare a ready ward (a wrong password is refused first)', async ({ page }) => {
  const w = world().wards.ready;
  await page.goto(`/wards/${w.id}`);
  await page.getByRole('link', { name: 'घोषणा करें' }).click();
  await expect(page.getByTestId('declare-winner')).toContainText('विजेता: अमर सिंह · अंतर: 102');
  await expect(page.getByTestId('total-valid')).toHaveText('519');
  await page.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)').fill('wrong-password-123');
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByRole('alert')).toContainText('पासवर्ड गलत है');
  await expect(page.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)')).toHaveValue(''); // not kept
  await page.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByText('वार्ड घोषित: विजेता अमर सिंह, अंतर 102')).toBeVisible();
  await page.getByRole('link', { name: 'वार्ड पर वापस' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('घोषित');
});

test('a tied ward needs the lottery result', async ({ page }) => {
  const w = world().wards.tie;
  await page.goto(`/wards/${w.id}/declare`);
  await expect(page.getByText('शीर्ष पर बराबरी — लॉटरी आवश्यक')).toBeVisible();
  await page.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByRole('alert')).toContainText('लॉटरी');
  await page.getByRole('radio', { name: /भरत कुमार/ }).check();
  await page.getByLabel('लॉटरी किसने कराई (3–100 अक्षर)').fill('रिटर्निंग अधिकारी');
  await page.getByLabel('लॉटरी का विवरण (10–500 अक्षर)').fill('दोनों उम्मीदवारों के सामने पर्ची निकाली गई');
  await page.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByText('वार्ड घोषित: विजेता भरत कुमार, अंतर 0 (लॉटरी से)')).toBeVisible();
});

test('NOTA highest: the acknowledgement checkbox is required', async ({ page }) => {
  const w = world().wards.nota;
  await page.goto(`/wards/${w.id}/declare`);
  await expect(page.getByText('नोटा को सबसे अधिक मत (401)')).toBeVisible();
  await page.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByRole('alert')).toContainText('नोटा');
  await page.getByRole('checkbox', { name: /मैंने नोटा के सर्वाधिक मत देख लिए हैं/ }).check();
  await page.getByLabel('अपना पासवर्ड दोबारा लिखें (पुष्टि के लिए)').fill(world().password);
  await page.getByRole('button', { name: 'घोषणा की पुष्टि करें' }).click();
  await expect(page.getByText('वार्ड घोषित: विजेता भरत कुमार, अंतर 20')).toBeVisible();
});
