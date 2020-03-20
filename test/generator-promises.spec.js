import test from 'ava';
import express from 'express';
import request from 'supertest';
import multer from 'multer';

import {files, cleanStorage} from './utils/testutils';
import {storageOptions} from './utils/settings';
import GridFsStorage from '..';

async function successfulPromiseSetup(t) {
	const app = express();
	t.context.filePrefix = 'file';
	const storage = new GridFsStorage({
		...storageOptions(),
		*file() {
			let counter = 0;
			for (;;) {
				yield Promise.resolve({filename: t.context.filePrefix + (counter + 1)});
				counter++;
			}
		}
	});
	t.context.storage = storage;

	const upload = multer({storage});

	app.post('/url', upload.array('photos', 2), (request_, response) => {
		t.context.result = {
			headers: request_.headers,
			files: request_.files,
			body: request_.body
		};
		response.end();
	});

	await storage.ready();
	await request(app)
		.post('/url')
		.attach('photos', files[0])
		.attach('photos', files[1]);
}

test.afterEach.always('cleanup', t => {
	return cleanStorage(t.context.storage);
});

test('yielding a promise is resolved as file configuration', async t => {
	await successfulPromiseSetup(t);
	const {result} = t.context;
	t.true(Array.isArray(result.files));
	t.is(result.files.length, 2);
	result.files.forEach((f, idx) =>
		t.is(f.filename, t.context.filePrefix + (idx + 1))
	);
});

async function failedPromiseSetup(t) {
	const app = express();
	t.context.rejectedError = new Error('reason');
	const storage = new GridFsStorage({
		...storageOptions(),
		*file() {
			yield Promise.reject(t.context.rejectedError);
		}
	});
	t.context.storage = storage;
	const upload = multer({storage});

	app.post(
		'/url',
		upload.array('photos', 2),
		(err, request_, response, next) => {
			t.context.error = err;
			next();
		}
	);

	await storage.ready();
	await request(app)
		.post('/url')
		.attach('photos', files[0]);
}

test('yielding a promise rejection is handled properly', async t => {
	await failedPromiseSetup(t);
	const {error, storage} = t.context;
	const {db} = storage;
	t.true(error instanceof Error);
	t.is(error, t.context.rejectedError);
	const collection = db.collection('fs.files');
	const count = await (collection.estimatedDocumentCount
		? collection.estimatedDocumentCount()
		: collection.count());
	t.is(count, 0);
});
