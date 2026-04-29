import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    { ignores: ['dist'] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': [
                'warn',
                { allowConstantExport: true },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

            // ===== XSS 防御（P1E v4.1 codex 强制项）=====
            // 禁止任何 HTML 注入向量；用户输入必须用 React 文本节点渲染（<span>{userInput}</span>）
            // 如果未来需要 markdown 渲染，引入 dompurify 严格白名单后单独 eslint-disable-next-line
            'no-restricted-syntax': [
                'error',
                {
                    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
                    message:
                        '禁止 dangerouslySetInnerHTML（XSS 风险）。用户输入必须用 React 文本节点渲染，如 <span>{userInput}</span>。',
                },
                {
                    selector: "MemberExpression[property.name='innerHTML']",
                    message: '禁止直接赋值 innerHTML（XSS 风险）。用 textContent 或 React 文本节点。',
                },
                {
                    selector: "MemberExpression[property.name='outerHTML']",
                    message: '禁止直接赋值 outerHTML（XSS 风险）。',
                },
                {
                    selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
                    message: '禁止 document.write（XSS 风险 + 阻塞渲染）。',
                },
            ],
        },
    },
);
