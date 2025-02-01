# AdaptivAI API Documentation

# Endpoints :

List of available endpoints:

## Auth Routes

- `POST /login`
- `POST /register`
- `POST /google-login`

## Dashboard Routes

- `GET /modules/:userId` >> di limitation 3 modules max
- `GET /pub/modules/featured` >> di limitation 5 modules max
- `GET /pub/modules/recommedation` >> di limitation 3 modules max
- `GET /discussion/featured` >> di limit 10 topic max

## Profile Routes

- `GET /user/:id`
- `PUT /user/:id`

## Discussion Routes

- `GET /discussion`
- `POST /discussion`
- `GET /discussion/:id`
- `PUT /discussion/:id`
- `PATCH /dicussion/:id/likes`
- `PATCH /dicussion/:id/comments`

## Public Modules Routes

- `GET /pub/modules` >>> pagination and search
- `GET /pub/modules/:moduleId` 

- `POST /pub/modules/:moduleId` >> generate instance module (Add to user collection)

## User Modules Routes

- `POST /modules` >>> yang dikirim PDF
- `GET /modules`
- `GET /modules/:instanceId`
- `POST /modules/:instanceId/chapters/:chapterId `
- `GET /modules/:instanceId/chapters/:chapterId`
- `GET /modules/:instanceId/assesment`
- `PUT /modules/:instanceId/assesment`
- `POST /modules/:instanceId/evaluate`
- `POST /modules/:instanceId/adapt` >>> kirim ke gemini
- `GET /modules/:instanceId/chapters/:chapterId/levels`
- `GET /modules/:instanceId/chapters/:chapterId/feedbacks`



# READ FULL DOCS

## 1. POST /login

Description:

- Login Page

Request:

- body:

```json
{
  "email": "String",
  "password": "String"
}
```

_Response (200 - OK)_

```json
{
  "access_token": "String"
}
```

&nbsp;

## 2. POST /register

Description:

- Register Page

Request:

- body:

```json
{
  "email": "String",
  "password": "String"
}
```

_Response (201 - Created)_

```json
{
  "message": "Successfully register new account"
}
```

&nbsp;

## 3. GET /modules/:userId

Description:

- Home Page >> On Going Module Section (Get On Going Module Limit by 3)

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "userId": "string"
}
```

_Response (200 - OK)_

```json
[
    "UserModule" {
        "_id": "ObjectId('String')",
        "title": "string",
        "module_progress": "integer",
        "status": "in_progress"
    },
    ...
]
```

&nbsp;

## 4. GET /pub/modules/featured

Description:

- Home Page >> Featured public module (Get most popular module/most copy module limit of 5)

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

_Response (200 - OK)_

```json
[
    "MasterModule" {
        "_id": "ObjectId('String')",
        "title": "string",
        "excerpt": "string",
        "createdBy": "string",
        "totalSubscribers": "integer"
    },
    ...
]
```

&nbsp;

## 5. GET /pub/modules/recommedation

Description:

- Home Page >> Recommended public module (Get recommeded module by admin limit of 3)

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

_Response (200 - OK)_

```json
[
    "MasterModule" {
        "_id": "ObjectId('String')",
        "title": "string",
        "excerpt": "string",
        "createdBy": "string",
        "isRecommended": true,
    },
    ...
]
```

&nbsp;

## 6. GET /pub/modules

Description:

- Get All Public Modules

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

_Response (200 - OK)_

```json
[
    "MasterModule" {
        "_id": "ObjectId('String')",
        "title": "string",
        "excerpt": "string",
        "createdBy": "string",
        "totalSubscriber": "integer",
        "createdDate": "date",
        "language": "string"
    },
    ...
]
```

&nbsp;

## 7. GET /pub/modules/:moduleId

Description:

- Get Public Module by Id

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "moduleId": "string"
}
```

_Response (200 - OK)_

```json
  "ModuleMaster": {
    "_id": "ObjectId",
    "title": "String",
    "description": "String",
    ""
    "excerpt": "String",
    "createdAt": "Date",
    "updatedAt": "Date",
    "createdBy": "ObjectId", // Reference to User
    "chapters": [{
      "_id": "ObjectId",
      "title": "String",
      "order": "Number",
      "summaries": [{
        "_id": "ObjectId",
        "content": "String",
        "comprehensionLevel": "Number", // 1-6 sesuai taxonomy bloom
        "flashcardFront": "String",
        "flashcardBack": "String"
      }]
    }],
    "subscribedUsers": ["ObjectId"], // Array of User IDs yang menambahkan modul
    "isRecommeded": "Boolean" // Default false
  }
```

&nbsp;

## 8. POST /pub/modules/:moduleId

Description:

- Add Public modules to User Collection

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "moduleId": "string"
}
```

_Response (201 - created)_

```json
  "ModuleMaster": {
    "_id": "ObjectId",
    "title": "String",
    "description": "String",
    ""
    "excerpt": "String",
    "createdAt": "Date",
    "updatedAt": "Date",
    "createdBy": "ObjectId", // Reference to User
    "chapters": [{
      "_id": "ObjectId",
      "title": "String",
      "order": "Number",
      "summaries": [{
        "_id": "ObjectId",
        "content": "String",
        "comprehensionLevel": "Number", // 1-6 sesuai taxonomy bloom
        "flashcardFront": "String",
        "flashcardBack": "String"
      }]
    }],
    "subscribedUsers": ["ObjectId"], // Array of User IDs yang menambahkan modul
    "isRecommeded": "Boolean" // Default false
  }

  atau

  {
    "message": "Successfully add module to your collection"
  }
```

&nbsp;

## 9. POST /modules

Description:

- Generate new modules (save to master collection and instance user collection)

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- body:

```json
{
  "pdf": "file",
  "language": "string",
  "additional_notes": "string" // optional (null allowed)
}
```

_Response (201 - created)_

```json
  "ModuleMaster": {
    "_id": "ObjectId",
    "title": "String",
    "description": "String",
    ""
    "excerpt": "String",
    "createdAt": "Date",
    "updatedAt": "Date",
    "createdBy": "ObjectId", // Reference to User
    "chapters": [{
      "_id": "ObjectId",
      "title": "String",
      "order": "Number",
      "summaries": [{
        "_id": "ObjectId",
        "content": "String",
        "comprehensionLevel": "Number", // 1-6 sesuai taxonomy bloom
        "flashcardFront": "String",
        "flashcardBack": "String"
      }]
    }],
    "subscribedUsers": ["ObjectId"], // Array of User IDs yang menambahkan modul
    "isRecommeded": "Boolean" // Default false
  }

  atau

  {
    "message": "Succesfully generate master module and automatically add to user collection"
  }
```

&nbsp;

## 10. GET /modules

Description:

- Get All User Modules

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

_Response (200 - OK)_

```json
[
    "ModuleInstance" {
        "_id": "ObjectId('string')",
        "moduleMasterId": "ObjectId('string')",
        "title": "string",
        "excerpt": "string",
        "createdDate": "date",
        "status": "string",
        "lastAccessedAt": "Date",
    },
    ...
]
```

&nbsp;

## 11. GET /modules/:instanceId

Description:

- Get Detail Modules -> Get current status + all Chapters

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "instanceId": "String" // Instance Id
}
```

_Response (200 - OK)_

```json
{
    "ModuleInstance" {
        "_id": "ObjectId('String')",
        "moduleMasterId": "ObjectId('string')",
        "title": "string",
        "progress": {
            "completedChapters": ["ObjectId('string')", ...],
        },
        "chapters": [{
            "_id" : "ObjectId('string')",
            "title" : "string",
            "order" : "number"
        }],
        "excerpt": "string",
        "createdDate": "date",
        "status": "string",
        "lastAccessedAt": "Date",
        "currentState": {
            "currentChapterIndex": "Number",
            "currentLevelIndex": "Number",
            "comprehensionScore": "Number", // 0-100
            "lastAssessmentLevel": "Number" // Level Bloom terakhir
        },
    },
    ...
}
```

&nbsp;

## 12. POST /modules/:instanceId/chapters/:chapterId 
 ```json
    // Ini untuk generate chapter content
    // Nanti tolong dika di isi sesuai server
 ```

## 13. GET /modules/:instanceId/chapters/:chapterId

Description:

- Get Detail Modules -> Get current status + all Chapters

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "instanceId": "String",
  "chapterId": "String"
}
```

_Response (200 - OK)_

```json
{
  "chapter": [
    {
      "_id": "ObjectId('string')",
      "title": "string",
      "order": "number",
      "summaries": [
        {
          "_id": "ObjectId",
          "content": "String",
          "comprehensionLevel": "Number", // 1-6 sesuai taxonomy bloom
          "flashcardFront": "String",
          "flashcardBack": "String"
        }
      ]
    }
  ]
}
```

&nbsp;

## 14. GET /modules/:instanceId/assesment

Description:

- Get Assesment -> User work on assessment

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "instanceId": "String",
}
```

_Response (200 - OK)_

```json
{
  "currentQuestions": [
    {
      "questionId": "ObjectId",
      "question": "string",
      "options": ["string", ...],
      "correctAnswer": ["Number"], // index dari correct options
      "explanation": "string",
      "status": "String", // "pending", "completed"
      "userAnswer": "Number",
      "isCorrect": "Boolean",
      "answeredAt": "Date"
    }
  ]
}
```

&nbsp;

## 15. PUT /modules/:instanceId/assesment

Description:

- Post answer -> User Answer question

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "instanceId": "String",
}
```

- body:

```json
{
  "userAnswer": "Number", // index dari option yang dipilih
  "questionId": "ObjectId('string')"
}
```

_Response (200 - OK)_

```json
{
    "message": "Benar" || "Salah",
}
```

&nbsp;

## 16. POST /modules/:instanceId/evaluate

Description:

- Post assesment -> Send assesment to gemini

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "instanceId": "String",
}
```

_Response (201 - Created)_

```json
{
  "assessmentResult": "String",
  "feedback": "string",
  "nextOrRepeat": "string"
}
```

&nbsp;

## 17. POST /modules/:instanceId/adapt

```json
// Ini replace only current questions
// Dika tolong dibuat sesuai dengan server rules
```

&nbsp;

## 18. GET /modules/:instanceId/chapters/:chapterId/levels

Description:

- Get All Levels (Practice Problems)

Request:

- headers:

```json
{
  "Authorization": "Bearer <access_token>"
}
```

- params:

```json
{
  "instanceId": "String",
  "chapterId": "String"
}
```

_Response (200 - OK)_

```json
{
    "ModuleInstance" {
        "_id": "ObjectId('String')",
        "moduleMasterId": "ObjectId('string')",
        "chapters": [{
            "_id" : "ObjectId('string')",
            "levels": [{
                "_id": "ObjectId",
                "bloomLevel": "Number", // 1-6
                "questions": [{
                "_id": "ObjectId",
                "question": "String",
                "options": ["String"],
                "correctAnswer": "Number", // index dari options
                "explanation": "String",
                "bloomLevel": "Number",
                "levels": [{
                    "_id": "ObjectId",
                    "bloomLevel": "Number", // 1-6
                    "questions": [{
                        "_id": "ObjectId",
                        "question": "String",
                        "options": ["String"],
                        "correctAnswer": "Number", // index dari options
                        "explanation": "String",
                        "bloomLevel": "Number",
                        }]
                    }]
                }]
            }]
        }],
    },
    ...
}
```

## 19. GET /modules/:instanceId/chapters/:chapterId/feedbacks
```json
// Ini buat ambil feedback dari AI
// Dika tolong dibuat sesuai dengan server rules
```



# CATATAN AWAL
<!-- INI NOTES AWAL PEMBUATAN -->

### User Modules

- Upload PDF
- Create New Modules
- Get Module
- Get Chapter
- Get Level ==> Summary, progress assesment

- Get Assesment ==> Assesment, kunci jawaban
- Put Assesment >>> jawab soal 1 an

- Post Assesment >>> setelah 10 soal terjawab dikirim ke gemini

- Get Modules >>> access seluruh user modules

### Collection-modules

Id:
userId:
moduleId:

### Discussion

discussionId:
userId:
title :
content :
comments []:
likes []:

comment {
commentId:
userId:
content:
comments []:
likes []:
}

### Dash board

- On Going/On Progress Modules max.3 (turun kebawah) > Module Ready
- Featured Public Module up to 5 (kesamping) > see All > Public module lists page
- Hot Discussion Topic max.3 > see All > Access Forum
- Course Promotion > see All > Course Lists Page

### public module screens

- public module lists
- public module details
- add to collections
- favourites

### conditional important

- conditional add to collection
- if (user.name / user.\_id !== createdBy)

&nbsp;
### On Going Modules

limit 3 max.

[
UserModule {
// require key: -> isOnGoing : true
_id : ObjectId(string)
progress presentation: integer
title : string
}
]

### Feature Public Modules

limit 5 max.

[
PublicModule {
// based on popularity -> sort total copy to collection
_id : ObjectId(string)
title: string,
excerpt: string,
createdBy : string,
totalCopy : integer,
}
]

### Recommend Public Modules.

limit 3 max.

[
RecommendPublicModule {
_id : ObjectId(string),
title: string,
excerpt: string,
createdBy : string,
}
]

# Data structure Master Module Collection

```json

  "ModuleMaster": {
    "_id": "ObjectId",
    "title": "String",
    "description": "String",
    ""
    "excerpt": "String",
    "createdAt": "Date",
    "updatedAt": "Date",
    "createdBy": "ObjectId", // Reference to User
    "chapters": [{
      "_id": "ObjectId",
      "title": "String",
      "order": "Number",
      "summaries": [{
        "_id": "ObjectId",
        "content": "String",
        "comprehensionLevel": "Number", // 1-6 sesuai taxonomy bloom
        "flashcardFront": "String",
        "flashcardBack": "String"
      }],
      "levels": [{
        "_id": "ObjectId",
        "bloomLevel": "Number", // 1-6
        "questions": [{
          "_id": "ObjectId",
          "question": "String",
          "options": ["String"],
          "correctAnswer": "Number", // index dari options
          "explanation": "String",
          "bloomLevel": "Number",
          "usersAttempted": [{
            "userId": "ObjectId",
            "isCorrect": "Boolean",
            "attemptedAt": "Date"
          }]
        }]
      }]
    }],
    "subscribedUsers": ["ObjectId"], // Array of User IDs yang menambahkan modul
    "isRecommeded": "Boolean" // Default false
  }


    "ModuleInstance": {
    "_id": "ObjectId",
    "moduleMasterId": "ObjectId", // Reference ke ModuleMaster
    "userId": "ObjectId", // User yang sedang mengerjakan
    "currentState": {
      "currentChapterIndex": "Number",
      "currentLevelIndex": "Number",
      "comprehensionScore": "Number", // 0-100
      "lastAssessmentLevel": "Number" // Level Bloom terakhir
    },
    "progress": {
      "completedChapters": ["ObjectId"], // Array of Chapter IDs
      "masteredLevels": [{
        "chapterId": "ObjectId",
        "levelId": "ObjectId",
        "masteredAt": "Date"
      }],
      "currentQuestions": [{
        "questionId": "ObjectId",
        "status": "String", // "pending", "completed"
        "userAnswer": "Number",
        "isCorrect": "Boolean",
        "answeredAt": "Date"
      }]
    },
    "adaptiveHistory": [{
      "timestamp": "Date",
      "previousLevel": "Number",
      "newLevel": "Number",
      "assessmentScore": "Number",
      "generatedQuestions": ["ObjectId"] // Reference ke questions baru yang digenerate
    }],
    "startedAt": "Date",
    "lastAccessedAt": "Date",
    "completedAt": "Date",
    "status": "String" // "in_progress", "completed", "abandoned"
  }

```
