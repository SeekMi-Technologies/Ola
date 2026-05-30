// @vitest-environment jsdom

import { describe, test, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import { DatePicker } from 'antd';
import Localization from '../Localization';

const makeStore = (lang) =>
  createStore(() => ({ lang: { current: lang } }));

const renderWithLang = (lang) =>
  render(
    <Provider store={makeStore(lang)}>
      <Localization>
        <DatePicker />
      </Localization>
    </Provider>
  );

afterEach(cleanup);

describe('Localization — ConfigProvider locale wiring', () => {
  test('zh mode: AntD DatePicker placeholder renders in Chinese', () => {
    const { container } = renderWithLang('zh');
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('请选择日期');
  });

  test('en mode: AntD DatePicker placeholder renders in English', () => {
    const { container } = renderWithLang('en');
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Select date');
  });

  test('unknown lang (e.g. tampered): falls back to en placeholder', () => {
    const { container } = renderWithLang('fr');
    const input = container.querySelector('input');
    expect(input.placeholder).toBe('Select date');
  });

  test('null lang: falls back to en placeholder', () => {
    const { container } = renderWithLang(null);
    const input = container.querySelector('input');
    expect(input.placeholder).toBe('Select date');
  });

  test('placeholders differ between zh and en (anti-regression sanity)', () => {
    const { container: zhContainer } = renderWithLang('zh');
    const zhPlaceholder = zhContainer.querySelector('input').placeholder;
    cleanup();
    const { container: enContainer } = renderWithLang('en');
    const enPlaceholder = enContainer.querySelector('input').placeholder;
    expect(zhPlaceholder).not.toBe(enPlaceholder);
  });
});
