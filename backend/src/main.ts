import express, {Request, Response} from 'express';
import fs from 'fs';
import cors from 'cors';
import 'flexsearch';

import { Log, loadJson } from './utils';

const { Index } = require("flexsearch");

// Indexes to search the words to be able to rank them.
const profile = 'default'
const async = false;
const resolution = 9;
const worker = false;
const optimize = true;
const context = true;
const stemmer = true;

const dictionaryWordStrictIndex: any = new Index({tokenize: 'strict', profile, worker, resolution, async, optimize});
const dictionaryWordForwardIndex: any = new Index({tokenize: 'forward', profile, worker, resolution, async, optimize});
const dictionaryWordFullIndex: any = new Index({tokenize: 'full', profile, worker, resolution, async, optimize, context, stemmer});

// Index to search the definitions
const dictionaryDefinitionIndex: any = new Index({tokenize: 'strict', profile, worker, resolution, async, optimize});

const app = express();
app.use(cors());


type Word = string;
type Definition = string
type DefinitionWrapper = {definition: Definition, idx: number};

const dictionaryEntries: [string, DefinitionWrapper][] = [];
const dictionaryMap = new Map<Word, DefinitionWrapper>();

function loadData() {
    const mbStr = fs.statSync('./data/dictionary.json').size.toMegaByteString();

    // Loading the data to the index
    Log.info(`Started loading ${mbStr} of dictionary data to the index`);
    Log.info('Memory before loadData');
    Log.memory();

    console.time('loadData');
    const dictionaryStr = fs.readFileSync('./data/dictionary.json', {encoding: 'utf-8', flag: 'r'});
    const dictionaryJson = JSON.parse(dictionaryStr);
    const dictionaryEntries = Object.entries(dictionaryJson) as [string, string][];

    for(let i = 0; i < dictionaryEntries.length; i++) {
        const [word, definition] = dictionaryEntries[i];
        addWordDefinition(word, definition, i);
    }
    console.timeEnd('loadData');

    Log.info(`Done loading ${mbStr} dictionary with ${dictionaryEntries.length.toLocaleString('en-US')} records`);
    Log.info('Memory after loadData');
    Log.memory();
}

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
 * Get Word Handler
 */
app.get('/dictionary/get/:word', dictionaryGetHandler);
function dictionaryGetHandler(req: Request, res: Response) {
    const word = String(req.params.word);
    const found = dictionaryMap.get(word);
    if(!found) {
        res.status(404).json({ error: "Word not found."}).end();
    }
    else {
        res.status(200).json({word, definition: found.definition}).end();
    }
} 

/**
 * Set Word handler
*/
app.get('/dictionary/set/:word/:definition', dictionarySetHandler);
function dictionarySetHandler(req: Request, res: Response) {
    const word = req.params.word;
    const definition = req.params.definition;

    const prev = dictionaryMap.get(word);
    const response = {success: true, addOrUpdate: ''};
    if(prev) {
        // Updating definition on the wrapper reference shared by the map and entries array
        prev.definition = definition;

        // Update the definition on the index
        dictionaryDefinitionIndex.update(prev.idx, definition);
        response.addOrUpdate = 'update';
    }
    else {
        addWordDefinition(word, definition, dictionaryEntries.length);
        response.addOrUpdate = 'add'
    }

    res.status(200).json(response).end();
}

/**
 * Word search handler
*/
app.get('/dictionary/search_words', dictionarySearchWordsRandkedHandler);
app.get('/dictionary/search_words_ranked', dictionarySearchWordsRandkedHandler);
function dictionarySearchWordsRandkedHandler(req: Request, res: Response) {
    const query = String(req.query.q)//.split(' ');

    var limit = Number.parseInt(String(req.query.limit));
    limit = isNaN(limit)? 25:limit;

    var offset = Number.parseInt(String(req.query.offset));
    offset = isNaN(offset)? 0:offset;

    var suggest = (String(req.query.suggest).toLocaleLowerCase().trim() === 'false') ? false : true;
    suggest = true;
    const strictResults: {word: string, definition: string}[] = [];

    const strictResultIndexes = dictionaryWordStrictIndex.search(query, {limit, offset, suggest});
    for(const idx of strictResultIndexes) {
        const [word, wrapper] = dictionaryEntries[idx];
        const definition = wrapper.definition;
        strictResults.push({word, definition})
    }
    strictResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1));

    if(strictResults.length >= limit) {
        const results = strictResults
        results.length = limit;
        res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
        return;
    }

    const forwardResults: {word: string, definition: string}[] = [];
    const forwardResultIndexes = dictionaryWordForwardIndex.search(query, {limit, offset, suggest});
    const strictIndexesSet = new Set<number>(strictResultIndexes);
    for(let idx of forwardResultIndexes) {
        if(strictIndexesSet.has(idx)) continue;

        const [word, wrapper] = dictionaryEntries[idx];
        forwardResults.push({word, definition: wrapper.definition});
    }
    forwardResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1))

    if((strictResults.length + forwardResults.length) >= limit) {
        const results = [...strictResults, ...forwardResults]
        results.length = Math.min(results.length, limit);
        res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
        return;
    }
    
    const fullResults: {word: string, definition: string}[] = [];
    const forwardResultIndexesSet = new Set<number>(forwardResultIndexes);
    const fullResultIndexes = dictionaryWordFullIndex.search(query, {limit, offset, suggest: true});
    for(let idx of fullResultIndexes) {
        if(forwardResultIndexesSet.has(idx) || strictIndexesSet.has(idx)) continue;

        const [word, wrapper] = dictionaryEntries[idx];
        fullResults.push({word, definition: wrapper.definition});
    }

    fullResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1));

    const results = [...strictResults, ...forwardResults, ...fullResults];
    results.length = Math.min(results.length, limit);
    res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
}

/**
 * Word search handler
*/
app.get('/dictionary/search_words_strict', dictionarySearchWordsHandlerStrict);
function dictionarySearchWordsHandlerStrict(req: Request, res: Response) {
    const query = String(req.query.q);

    var limit = Number.parseInt(String(req.query.limit));
    limit = isNaN(limit)? 25:limit;

    var offset = Number.parseInt(String(req.query.offset));
    offset = isNaN(offset)? 0:offset;

    const suggest = (String(req.query.suggest).toLocaleLowerCase().trim() === 'false') ? false : true;

    const preResults: {word: Word, wrapper: DefinitionWrapper}[] = [];

    const strictResultIndexes: number[] = dictionaryWordStrictIndex.search(query, {limit: 25, suggest: true});
    const forwardResultIndexes: number[] = [] //dictionaryWordForwardIndex.search(query, {limit: 25, suggest: true});
    const fullResultIndexes: number[] = [] //dictionaryWordFullIndex.search(query, {limit, offset, suggest});

    const allIndexes = [...strictResultIndexes, ...forwardResultIndexes, ...fullResultIndexes]
    const allIndexSet = new Set<number>(allIndexes);

    for(let idx of allIndexSet) {
        const [word, wrapper] = dictionaryEntries[idx];
        preResults.push({word, wrapper});
    }

    //preResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1));
    //preResults.length = Math.min(preResults.length, limit);
    const results = preResults.map(({word, wrapper: {definition}}) => {return {word: word, definition}});
    res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
}

/**
 * Word search handler
*/
app.get('/dictionary/search_words_forward', dictionarySearchWordsHandlerForward);
function dictionarySearchWordsHandlerForward(req: Request, res: Response) {
    const query = String(req.query.q);

    var limit = Number.parseInt(String(req.query.limit));
    limit = isNaN(limit)? 25:limit;

    var offset = Number.parseInt(String(req.query.offset));
    offset = isNaN(offset)? 0:offset;

    const suggest = (String(req.query.suggest).toLocaleLowerCase().trim() === 'false') ? false : true;

    const preResults: {word: Word, wrapper: DefinitionWrapper}[] = [];

    const strictResultIndexes: number[] = [] //dictionaryWordStrictIndex.search(query, {limit: 25, suggest: true});
    const forwardResultIndexes: number[] = dictionaryWordForwardIndex.search(query, {limit: 25, suggest: true});
    const fullResultIndexes: number[] = [] //dictionaryWordFullIndex.search(query, {limit, offset, suggest});

    const allIndexes = [...strictResultIndexes, ...forwardResultIndexes, ...fullResultIndexes]
    const allIndexSet = new Set<number>(allIndexes);

    for(let idx of allIndexSet) {
        const [word, wrapper] = dictionaryEntries[idx];
        preResults.push({word, wrapper});
    }

    //preResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1));
    //preResults.length = Math.min(preResults.length, limit);
    const results = preResults.map(({word, wrapper: {definition}}) => {return {word: word, definition}});
    res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
}

/**
 * Word search handler
*/
app.get('/dictionary/search_words_full', dictionarySearchWordsHandlerFull);
function dictionarySearchWordsHandlerFull(req: Request, res: Response) {
    const query = String(req.query.q);

    var limit = Number.parseInt(String(req.query.limit));
    limit = isNaN(limit)? 25:limit;

    var offset = Number.parseInt(String(req.query.offset));
    offset = isNaN(offset)? 0:offset;

    const suggest = (String(req.query.suggest).toLocaleLowerCase().trim() === 'false') ? false : true;

    const preResults: {word: Word, wrapper: DefinitionWrapper}[] = [];

    const strictResultIndexes: number[] = [] //dictionaryWordStrictIndex.search(query, {limit: 25, suggest: true});
    const forwardResultIndexes: number[] = [] //dictionaryWordForwardIndex.search(query, {limit: 25, suggest: true});
    const fullResultIndexes = dictionaryWordFullIndex.search(query, {limit, offset, suggest});

    const allIndexes = [...strictResultIndexes, ...forwardResultIndexes, ...fullResultIndexes]
    const allIndexSet = new Set<number>(allIndexes);

    for(let idx of allIndexSet) {
        const [word, wrapper] = dictionaryEntries[idx];
        preResults.push({word, wrapper});
    }

    //preResults.sort((a, b) => a.word.length === b.word.length ? 0 : (a.word.length > b.word.length? 1 : -1));
    //preResults.length = Math.min(preResults.length, limit);
    const results = preResults.map(({word, wrapper: {definition}}) => {return {word: word, definition}});
    res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
}

/**
 * Definition search handler
*/
app.get('/dictionary/search_definitions', dictionarySearcDefinitionshHandler);
function dictionarySearcDefinitionshHandler(req: Request, res: Response) {
    const query = String(req.query.q);

    var limit = Number.parseInt(String(req.query.limit));
    limit = isNaN(limit)? 25:limit;

    var offset = Number.parseInt(String(req.query.offset));
    offset = isNaN(offset)? 0:offset;

    const suggest = (String(req.query.suggest).toLocaleLowerCase().trim() === 'false') ? false : true;

    const resultIndexes = dictionaryDefinitionIndex.search(query, {limit, offset, suggest});
    const results = resultIndexes.map((x: number) => dictionaryEntries[x]).map((x: [string, DefinitionWrapper]) => { return {word: x[0], definition: x[1].definition}});
    res.status(200).json({query, limit, offset, suggest, results_length: results.length, results}).end();
}

loadData();
app.listen(8081)
