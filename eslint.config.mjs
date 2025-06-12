import { eslintConfig } from '@gewis/eslint-config-typescript';
import { eslintConfig as prettier } from '@gewis/prettier-config';

export default [...eslintConfig, prettier];
