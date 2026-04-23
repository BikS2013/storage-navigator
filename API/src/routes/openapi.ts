import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import type { Config } from '../config.js';

export function openapiRouter(config: Config): Router {
  const r = Router();
  const here = dirname(fileURLToPath(import.meta.url));
  // src/routes/ → ../../openapi.yaml
  const specPath = resolve(here, '../../openapi.yaml');
  const yamlText = readFileSync(specPath, 'utf8');
  const parsed = YAML.parse(yamlText);

  r.get('/openapi.yaml', (_req, res) => {
    res.setHeader('Content-Type', 'application/yaml');
    res.send(yamlText);
  });

  if (config.swaggerUiEnabled) {
    r.use('/docs', swaggerUi.serve, swaggerUi.setup(parsed));
  }
  return r;
}
