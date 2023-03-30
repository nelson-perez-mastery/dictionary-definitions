import express, {Request, Response} from 'express';
import fs from 'fs';
import cors from 'cors';
import 'flexsearch';

import { Log, loadJson } from './utils';

const { Index } = require("flexsearch");

// Indexes to search the words to be able to rank them.
const profile = 'score'
const async = false;
const resolution = 9;
const worker = false;
const optimize = true;
const context = false;
const stemmer = false;

const dictionaryWordStrictIndex: any = new Index({tokenize: 'strict', profile, worker, resolution, async, optimize});
const dictionaryWordForwardIndex: any = new Index({tokenize: 'forward', profile, worker, resolution, async, optimize});
const dictionaryWordFullIndex: any = new Index({tokenize: 'full', profile, worker, resolution, async, optimize, context, stemmer});

// Index to search the definitions
const dictionaryDefinitionIndex: any = new Index({tokenize: 'strict', profile, worker, resolution, async, optimize});
type Word = string;
type Definition = string
type DefinitionWrapper = {definition: Definition, idx: number};

const dictionaryEntries: [string, DefinitionWrapper][] = [];
const dictionaryMap = new Map<Word, DefinitionWrapper>();

type WordDefinition = { word: Word, definition: Definition }

function sanitize(word: Word): Word  {
    return word.toLocaleLowerCase().trim();
}
/**
 * 
 * Adds a Word and a Definition to the store
 * 
 */
function addWordDefinition(word: Word, definition: Definition, idx: number) {
    // Creating reusable wrapper to avoid double memory creation of both map and array of entries definition string    
    const definitionWrapper = {definition, idx};

    dictionaryEntries.push([word, definitionWrapper]);
    dictionaryMap.set(word, definitionWrapper);
    
    // Word search index
    dictionaryWordStrictIndex.add(idx, word),
    dictionaryWordForwardIndex.add(idx, word),
    dictionaryWordFullIndex.add(idx, word),

    // Definition search index
    dictionaryDefinitionIndex.add(idx, definition)
}

/**
 * 
 * Load the from the 21MB `./data/dictionary.json` file to the map, entries array and search indexes
 * 
 */
function loadDictionaryAsset() {
    const mbStr = fs.statSync('./data/dictionary.json').size.toMegaByteString();

    // Loading the data to the index
    Log.info(`Started loading ${mbStr} of dictionary data to the index`);
    Log.info('Memory before loading the data');
    Log.memory();

    console.time('loading data duration');
    const dictionaryJson = loadJson('./data/dictionary.json', {});
    const dictionaryEntries = Object.entries(dictionaryJson) as [string, string][];

    for(let i = 0; i < dictionaryEntries.length; i++) {
        let [word, definition] = dictionaryEntries[i];
        word = sanitize(word);
        addWordDefinition(word, definition, i);
    }
    console.timeEnd('loading data duration');
    Log.info(`Done loading ${mbStr} dictionary with ${dictionaryEntries.length.toLocaleString('en-US')} records`);
    Log.info('Memory after loading the data');
    Log.memory();
}

loadDictionaryAsset();

async function onGetEvent(data: any)       { Log.info({msg: "Sending GET data to kafka",       data}); }
async function onInsertEvent(data: any)    { Log.info({msg: "Sending INSERT data to kafka",    data}); }
async function onUpdateEvent(data: any)    { Log.info({msg: "Sending UPDATE data to kafka",    data}) };
async function onDeleteEvent(data: any)    { Log.info({msg: "Sending DELETE data to kafka",    data}); }

// Setup the web server
const app = express();
app.use(cors());

const serverId = 'server-01';

/**
 * 
 * Get word Handler
 * 
 */
app.get('/dictionary/get/:word', dictionaryGetHandler);
function dictionaryGetHandler(req: Request, res: Response) {
    const word = sanitize(String(req.params.word));
    const found = dictionaryMap.get(word);
    if(!found) {
        res.status(404).json({ error: "Word not found."}).end();
    }
    else {
        res.status(200).json({serverId, word, definition: found.definition}).end();
    }
    onGetEvent({word, result: found});
} 

/**
 * 
 * Set (update/insert -> upsert) word handler
 * 
*/
app.get('/dictionary/set/:word/:definition', dictionarySetHandler);
function dictionarySetHandler(req: Request, res: Response) {
    const word = sanitize(req.params.word)
    const definition = req.params.definition;
    const response = dictionarySet(word, definition, false);
    res.status(200).json(res).end();
}

function dictionarySet(word: string, definition: string, replay: boolean) {
    const current = dictionaryMap.get(word);
    const response = {success: true, addOrUpdate: ''};
    var before: any = undefined;
    if(current) {
        before = {word, current}

        // Update the definition on the index
        dictionaryDefinitionIndex.update(current.idx, definition);
        response.addOrUpdate = 'update';
        // Updating definition on the wrapper reference shared by the map and entries array
        current.definition = definition;

        const after = {word, definition};
        if(!replay) onUpdateEvent({serverId, word, definition, response, before, after});    
    }
    else {
        addWordDefinition(word, definition, dictionaryEntries.length);
        response.addOrUpdate = 'add'
        if(!replay) onInsertEvent({serverId, word, definition, response, after: {word, definition}});
    }

    return response;
    // callOnSetHandlers() -> ex. update database, send kafka message, send notification to other nodes
}

/**
 * 
 * Delete word handler
 * 
*/
app.get('/dictionary/delete/:word', dictionaryDeleteHandler);
function dictionaryDeleteHandler(req: Request, res: Response) {
    const word = sanitize(req.params.word);
    dictionaryDelete(word, false);
    res.status(200).json({success: true}).end();
}

function dictionaryDelete(word: string, replay: boolean) {
    const prev = dictionaryMap.get(word);
    if(prev) {
        const idx = prev.idx;
        dictionaryDefinitionIndex.remove(idx);
        dictionaryWordStrictIndex.remove(idx);
        dictionaryWordForwardIndex.remove(idx);
        dictionaryWordFullIndex.remove(idx);
        dictionaryMap.delete(word);
    }
    if(!replay) onDeleteEvent({serverId, word, deleted: {word, definition: prev?.definition}});
    // callOnDeleteHandlers() -> ex. update database, send kafka message, send notification to other nodes
}

/**
 * 
 * Dictionary Definition search handler
 * 
*/
app.get('/dictionary/search_definitions', dictionarySearcDefinitionshHandler);
function dictionarySearcDefinitionshHandler(req: Request, res: Response) {
    const query = sanitize(String(req.query.q));

    var limit = Number.parseInt(String(req.query.limit));
    limit = isNaN(limit)? 25:limit;

    var offset = Number.parseInt(String(req.query.offset));
    offset = isNaN(offset)? 0:offset;

    const suggest = String(req.query.suggest).toLocaleLowerCase().trim() !== 'false';

    const resultIndexes = dictionaryDefinitionIndex.search(query, {limit, offset, suggest});
    const results = resultIndexes.map((x: number) => dictionaryEntries[x]).map((x: [string, DefinitionWrapper]) => { return {word: x[0], definition: x[1].definition}});
    res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
}

/**
 * 
 * Dictionary Word search handler helper which is ranked by tokenizer of strict, forward, 
 * and full in that order.
 * 
 */
function dictionarySearchWordsRandkedHandlerHelper(req: Request, res: Response, strict: boolean, forward: boolean, full: boolean, sort: boolean = true) {
    const query = sanitize(String(req.query.q))//.split(' ');

    var limit = Number.parseInt(String(req.query.limit));
    limit = isNaN(limit)? 25:limit;

    var offset = Number.parseInt(String(req.query.offset));
    offset = isNaN(offset)? 0:offset;

    const suggest = String(req.query.suggest).toLocaleLowerCase().trim() !== 'false';

    const strictResults: {word: string, definition: string}[] = [];

    const strictResultIndexes = strict ? dictionaryWordStrictIndex.search(query, {limit, offset, suggest}) : [];
    for(const idx of strictResultIndexes) {
        const [word, wrapper] = dictionaryEntries[idx];
        const definition = wrapper.definition;
        strictResults.push({word, definition})
    }
    if(sort) strictResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1));

    if(strictResults.length >= limit) {
        const results = strictResults
        results.length = limit;
        res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
        return;
    }

    const forwardResults: {word: string, definition: string}[] = [];
    const forwardResultIndexes = forward ? dictionaryWordForwardIndex.search(query, {limit, offset, suggest}) : [];
    const strictIndexesSet = new Set<number>(strictResultIndexes);
    for(let idx of forwardResultIndexes) {
        if(strictIndexesSet.has(idx)) continue;

        const [word, wrapper] = dictionaryEntries[idx];
        forwardResults.push({word, definition: wrapper.definition});
    }
    if(sort) forwardResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1))

    if((strictResults.length + forwardResults.length) >= limit) {
        const results = [...strictResults, ...forwardResults]
        results.length = Math.min(results.length, limit);
        res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
        return;
    }
    
    const fullResults: {word: string, definition: string}[] = [];
    const forwardResultIndexesSet = new Set<number>(forwardResultIndexes);
    const fullResultIndexes = full ? dictionaryWordFullIndex.search(query, {limit, offset, suggest: true}) : [];
    for(let idx of fullResultIndexes) {
        if(forwardResultIndexesSet.has(idx) || strictIndexesSet.has(idx)) continue;

        const [word, wrapper] = dictionaryEntries[idx];
        fullResults.push({word, definition: wrapper.definition});
    }

    if(sort) fullResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1));

    const results = [...strictResults, ...forwardResults, ...fullResults];
    results.length = Math.min(results.length, limit);
    res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
}

/**
 * 
 * Dictionary Word search handler which is ranked by first strict tokenized matches,
 * then forward tokenized matches and finally a full tokenized index matches.
 * 
*/
app.get('/dictionary/search_words', dictionarySearchWordsRandkedHandler);
app.get('/dictionary/search_words_ranked', dictionarySearchWordsRandkedHandler);
function dictionarySearchWordsRandkedHandler(req: Request, res: Response) {
    dictionarySearchWordsRandkedHandlerHelper(req, res, true, true, true, true);
}

/**
 * Helper handler for the dictionary word search handlers
 */
function searchWordHandlerHelper(req: Request, res: Response, strict: boolean, forward: boolean, full: boolean, sort: boolean = false): void {
    const query = String(req.query.q);

    var limit = Number.parseInt(String(req.query.limit));
    limit = isNaN(limit)? 25 : limit;

    var offset = Number.parseInt(String(req.query.offset));
    offset = isNaN(offset)? 0:offset;

    const suggest = (String(req.query.suggest).toLocaleLowerCase().trim() === 'false') ? false : true;

    const preResults: {word: Word, wrapper: DefinitionWrapper}[] = [];

    const strictResultIndexes: number[] = strict ? dictionaryWordStrictIndex.search(query, {limit, offset, suggest: true}): [];
    const forwardResultIndexes: number[] = forward ? dictionaryWordForwardIndex.search(query, {limit, offset, suggest: true}): [];
    const fullResultIndexes: number[] = full ? dictionaryWordFullIndex.search(query, {limit, offset, suggest}) : [];

    const allIndexes = [...strictResultIndexes, ...forwardResultIndexes, ...fullResultIndexes]
    const allIndexSet = new Set<number>(allIndexes);

    for(let idx of allIndexSet) {
        const [word, wrapper] = dictionaryEntries[idx];
        preResults.push({word, wrapper});
    }

    if(sort) preResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1));
    //preResults.length = Math.min(preResults.length, limit);
    const results = preResults.map(({word, wrapper: {definition}}) => {return {word: word, definition}});
    res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
}

/**
 * 
 * Dictionary Word strict search only
 * 
*/
app.get('/dictionary/search_words_strict', dictionarySearchWordsHandlerStrict);
function dictionarySearchWordsHandlerStrict(req: Request, res: Response) {
    searchWordHandlerHelper(req, res, true, false, false);
}

/**
 * 
 * Forward word search only
 * 
*/
app.get('/dictionary/search_words_forward', dictionarySearchWordsHandlerForward);
function dictionarySearchWordsHandlerForward(req: Request, res: Response) {
    searchWordHandlerHelper(req, res, false, true, false);
}

/**
 * 
 * Full word search only
 * 
*/
app.get('/dictionary/search_words_full', dictionarySearchWordsHandlerFull);
function dictionarySearchWordsHandlerFull(req: Request, res: Response) {
    searchWordHandlerHelper(req, res, false, false, true);
}

app.listen(8081);

/**
 * 
 * Setup listening for kafka messages to replay the operations across all 
 * 
 */
function listenForKafkaMessages(kafkaTopic: string, consumerGroupId: string) {
    const client: any = {
        on: (event: 'delete' | 'insert' | 'update' | 'get',
            func: (data: any, cb?: (error: any) => void) => void
        ) => {            
            func({msg: event, data: {serverId, word: 'word', otherData: ['definition', 'other']}});
        },
    }

    client.on('delete', (data: any) => {
        if(data.serverId != serverId) {
            dictionaryDelete(data.word, true);
        }
    });

    client.on('insert', (data: any) => {
        if(data.serverId != serverId) {
            dictionarySet(data.word, data.definition, true);
        }
    });

    client.on('update', (data: any) => {
        if(data.serverId != serverId) {
            dictionarySet(data.word, data.definition, true);
        }
    });
}

// Each server has it's consumerGroupID to replay all changes.
listenForKafkaMessages('my-topic', serverId + '-replays');
