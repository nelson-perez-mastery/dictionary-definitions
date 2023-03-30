# dictionary-definitions
Dictionary Definition NodeJS app test CRUD operations of in memory "db" with in-memory "search" where 21MB file dictionary with 100K+ entries is handled with multiple indexes takes less than ~600MB of RAM (memory cost mostly comes from the search indexes)

> Without search indexes I've loaded 400+ MB of data into memory. It is mostly limited by Node JS string length limit but I've figureout ways to get around that by saving the JSON differently in my personal projects.

## Setup

```sh
cd backend
npm install
npm start
```

Takes 4-8 seconds to load and build the search indexes.


## Take it for a spin and look at the events on the console

### Get
http://localhost:8081/dictionary/get/random


### Search
#### Words
http://localhost:8081/dictionary/search_words?q=random

### Definitions
http://localhost:8081/dictionary/search_definitions?q=space


### Set
#### Insert

http://localhost:8081/dictionary/get/random-word

http://localhost:8081/dictionary/search_words?q=random

http://localhost:8081/dictionary/set/random-word/inserted_description

http://localhost:8081/dictionary/get/random-word

http://localhost:8081/dictionary/search_words?q=random

#### Update

http://localhost:8081/dictionary/set/random-word/updated_description

http://localhost:8081/dictionary/search_words?q=random

http://localhost:8081/dictionary/get/random-word


### Delete

http://localhost:8081/dictionary/search_words?q=random

http://localhost:8081/dictionary/delete/random

http://localhost:8081/dictionary/search_words?q=random
