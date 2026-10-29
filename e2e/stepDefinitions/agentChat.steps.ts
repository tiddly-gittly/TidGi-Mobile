import { Then, When } from '@cucumber/cucumber';
import { by, device, element, expect as detoxExpect, waitFor } from 'detox';

const composer = () => element(by.label('向手机智能体发送消息'));
const sendButton = () => element(by.id('GC_SEND_TOUCHABLE'));
const draft = 'Native conversation layout check\nSecond line remains editable\nThird line does not hide Send';

When('I open the agent conversation', async () => {
  await element(by.label('Agent')).tap();
  await waitFor(element(by.label('对话选项'))).toBeVisible().withTimeout(10_000);
  await waitFor(composer()).toBeVisible().withTimeout(10_000);
});

When('I open and dismiss conversation history', async () => {
  await element(by.label('对话')).tap();
  await waitFor(element(by.label('关闭'))).toBeVisible().withTimeout(10_000);
  await element(by.label('关闭')).tap();
  await waitFor(element(by.label('关闭'))).not.toExist().withTimeout(10_000);
});

When('I open model parameters from the conversation menu', async () => {
  await element(by.label('对话选项')).tap();
  await waitFor(element(by.text('模型参数'))).toBeVisible().withTimeout(10_000);
  await element(by.text('模型参数')).tap();
  await waitFor(element(by.label('返回'))).toBeVisible().withTimeout(10_000);
});

When('I return from conversation settings', async () => {
  await element(by.label('返回')).tap();
  await waitFor(element(by.label('对话选项'))).toBeVisible().withTimeout(10_000);
});

Then('the compact conversation controls are visible', async () => {
  await detoxExpect(element(by.label('新建对话'))).toBeVisible();
  await detoxExpect(element(by.label('对话选项'))).toBeVisible();
  await detoxExpect(composer()).toBeVisible();
  await device.takeScreenshot('agent-compact-controls');
});

When('I type a multiline message without sending it', async () => {
  await composer().tap();
  await composer().typeText(draft);
  await waitFor(sendButton()).toBeVisible().withTimeout(10_000);
});

Then('the message composer and send action remain visible', async () => {
  await detoxExpect(composer()).toBeVisible();
  await detoxExpect(sendButton()).toBeVisible();
  await device.takeScreenshot('agent-multiline-composer');
});

When('I dismiss the keyboard and reopen the composer', async () => {
  await device.pressBack();
  await composer().tap();
});

When('I dismiss the keyboard', async () => {
  await device.pressBack();
});

Then('the multiline draft remains in the composer', async () => {
  await detoxExpect(composer()).toHaveText(draft);
});

Then('the multiline draft is retained', async () => {
  await detoxExpect(composer()).toHaveText(draft);
  await composer().replaceText('');
});
