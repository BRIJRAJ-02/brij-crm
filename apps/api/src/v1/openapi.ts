// The public API's reference (parity #34): an OpenAPI 3.1 document built from the very Zod schemas the routes parse
// with and the app answers with (`@crm/contracts`), through Zod 4's own `z.toJSONSchema`, so the reference can't
// drift from the code. Served at `GET /api/v1/openapi.json` with no key; Settings › Developer links to it.
import {
  ApiError,
  AttributeDefinition,
  ObjectSummary,
  PublicCreateRecordBody,
  PublicUpdateRecordBody,
  RecordView,
} from '@crm/contracts';
import * as z from 'zod';

/** A schema as JSON Schema, as an output (what the API answers) or an input (what it reads). */
function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  return rest;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ 'application/json': { schema } });
const refusal = (description: string) => ({ description, content: json(ref('Error')) });

const ERRORS = {
  '401': refusal('No live API key: a malformed, unknown or revoked key, or one whose maker left.'),
  '403': refusal('The key may only read, or its maker may not change this.'),
  '404': refusal('No such object or record, or one the key may not see.'),
  '422': refusal('The input is not in the shape the API takes, or a value is refused.'),
  '429': refusal(
    'Over 120 requests a minute for this key, 600 from one address, or 30 refused keys in 10 minutes. Wait `Retry-After` seconds.',
  ),
};

const objectParam = {
  name: 'object',
  in: 'path',
  required: true,
  description: 'The object, by id or API slug (`people`, `companies`, `deals` or your own).',
  schema: { type: 'string' },
};
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

/** The whole document. */
export function publicApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CRM API',
      version: '1',
      description:
        'Records of any object in your workspace. Send `Authorization: Bearer <key>` with a key from Settings › ' +
        'Developer. A key reads and writes only what the person who made it may, and a read only key never writes. ' +
        'Values are keyed by attribute id; `GET /objects/{object}/attributes` lists them.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ key: [] }],
    components: {
      securitySchemes: { key: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Object: jsonSchema(ObjectSummary, 'output'),
        Attribute: jsonSchema(AttributeDefinition, 'output'),
        Record: jsonSchema(RecordView, 'output'),
        CreateRecord: jsonSchema(PublicCreateRecordBody, 'input'),
        UpdateRecord: jsonSchema(PublicUpdateRecordBody, 'input'),
        Error: jsonSchema(ApiError, 'output'),
      },
    },
    paths: {
      '/objects': {
        get: {
          summary: 'List the objects the key may see',
          responses: {
            '200': {
              description: 'The objects.',
              content: json({ type: 'object', properties: { objects: { type: 'array', items: ref('Object') } } }),
            },
            '401': ERRORS['401'],
            '429': ERRORS['429'],
          },
        },
      },
      '/objects/{object}/attributes': {
        get: {
          summary: 'List an object’s attributes',
          parameters: [objectParam],
          responses: {
            '200': {
              description: 'The attributes the key may see.',
              content: json({ type: 'object', properties: { attributes: { type: 'array', items: ref('Attribute') } } }),
            },
            ...ERRORS,
          },
        },
      },
      '/objects/{object}/records': {
        get: {
          summary: 'List records, a page at a time',
          parameters: [
            objectParam,
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'The last page’s `nextCursor`.' },
          ],
          responses: {
            '200': {
              description: 'A page of records; `nextCursor` while there are more.',
              content: json({
                type: 'object',
                properties: { records: { type: 'array', items: ref('Record') }, nextCursor: { type: 'string' } },
              }),
            },
            ...ERRORS,
          },
        },
        post: {
          summary: 'Create a record',
          parameters: [objectParam],
          requestBody: { required: true, content: json(ref('CreateRecord')) },
          responses: { '201': { description: 'The record made.', content: json(ref('Record')) }, ...ERRORS },
        },
      },
      '/objects/{object}/records/{id}': {
        get: {
          summary: 'Get a record',
          parameters: [objectParam, idParam],
          responses: { '200': { description: 'The record.', content: json(ref('Record')) }, ...ERRORS },
        },
        patch: {
          summary: 'Change a record’s values',
          parameters: [objectParam, idParam],
          requestBody: { required: true, content: json(ref('UpdateRecord')) },
          responses: { '200': { description: 'The record as it is now.', content: json(ref('Record')) }, ...ERRORS },
        },
        delete: {
          summary: 'Move a record to the trash',
          description: 'A deleted record can be brought back from Settings › Trash for 30 days.',
          parameters: [objectParam, idParam],
          responses: {
            '200': {
              description: 'Deleted.',
              content: json({
                type: 'object',
                properties: { id: { type: 'string' }, deleted: { const: true } },
              }),
            },
            ...ERRORS,
          },
        },
      },
    },
  };
}
