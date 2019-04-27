'use strict';

require('dotenv').config();
const cors = require('cors');
const superagent = require('superagent');
const { Client } = require('pg');
const express = require('express'),
  app = express(),
  PORT = process.env.PORT || 3000,
  WEATHER_API_KEY = process.env.WEATHER_API_KEY,
  GEOCODE_API_KEY = process.env.GEOCODE_API_KEY;

app.use(cors());

const client = new Client(process.env.DATABASE_URL);
client.connect();
client.on('err', err => console.log(err));

// ERRORS
function handleError(err, res) {
  console.log('ERR', err);
  if (res) res.status(500).send('Sorry, something went wrong');
}



// LOCATION ------------------------------------------------------------


// CREATE LOCATION ROUTE
app.get('/location', getLocation);
// CREATE WEATHER ROUTE
app.get('/weather', getWeather);
// CREATE MOVIE ROUTE
app.get('/movies', getMovies);
// CREATE YELP ROUTE
app.get('/yelp', getYelpReviews);

// MOVIE --------------------------------------------------------------------

function getMovies(request, response) {

  const handler = {
    query: request.query.data,

    cacheHit: function (results) {
      response.send(results.row);
    },

    cacheMiss: function () {
      Movie.fetch(request.query.data)
        .then(data => {
          console.log(data);
          response.send(data);
        });
    }
  };
  Movie.lookup(handler);
}

function Movie(data) {
  this.title = data.title;
  this.overview = data.overview;
  this.average_votes = data.vote_average;
  this.total_votes = data.vote_count;
  this.image_url = data.poster_path;
  this.popularity = data.popularity;
  this.released_on = data.release_date;
  this.created_at = Date.now();
}

Movie.lookup = function (handler) {
  const SQL = `SELECT * FROM movies WHERE location_id=$1;`;
  client.query(SQL, [handler.query.location_id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got SQL data');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

Movie.prototype.save = function (id) {
  const SQL = `INSERT INTO movies (title, overview, average_votes, total_votes, image_url, popularity, released_on, created_at, location_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);`;

  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};


Movie.fetch = (location) => {
  const _URL = `https://api.themoviedb.org/3/movie/top_rated?api_key=${process.env.MOVIE_API_KEY}&language=en-US&page=1&region=${location.formatted_query}`;
  return superagent.get(_URL)
    .then(data => {
      console.log(data);
      const movieResults = data.body.results.map((result) => {
        const movie = new Movie(result);
        movie.save(location.id);
        return movie;
      });
      return movieResults;
    }
    );
};



// YELP -------------------------------------------------------------------------

function getYelpReviews(request, response) {

  const handler = {
    query: request.query,

    cacheHit: function (results) {
      response.send(results.row);
    },

    cacheMiss: function () {
      Yelp.fetch(request.query)
        .then(data => {
          console.log(data);
          response.send(data);
        });
    }
  };
  Yelp.lookup(handler);
}

function Yelp(data) {
  this.name = data.name;
  this.image_url = data.image_url;
  this.price = data.price;
  this.rating = data.rating;
  this.url = data.url;
}

Yelp.lookup = function (handler) {
  console.log(handler);
  const SQL = `SELECT * FROM yelps WHERE location_id=$1;`;
  client.query(SQL, [handler.query.location_id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got SQL data');
        handler.cacheHit(result);
      } else {
        console.log('Get data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

Yelp.prototype.save = function (id) {
  const SQL = `INSERT INTO yelps (name, image_url, price, rating, url, created_at, location_id) VALUES ($1,$2,$3,$4,$5,$6,$7);`;

  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Yelp.fetch = (location) => {
  const _URL = `https://api.yelp.com/v3/businesses/search?location=${location.search_query}&limit=20`;

  return superagent.get(_URL)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then(data => {
      console.log(data);
      const yelpResults = data.body.businesses.map((business) => {
        const restaurant = new Yelp(business);
        return restaurant;
      });

      return yelpResults;
    });
};


function getLocation(request, response) {
  const locationHandler = {

    query: request.query.data,

    cacheHit: (results) => {
      console.log('Got data from SQL');
      response.send(results.rows[0]);
    },

    cacheMiss: () => {
      Location.fetchLocation(request.query.data)
        .then(data => response.send(data));
    }
  };
  Location.lookupLocation(locationHandler);
}

function Location(query, data) {
  this.search_query = query;
  this.formatted_query = data.formatted_query;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

Location.prototype.save = function () {
  let SQL = `
  INSERT INTO locations
  (search_query, formatted_query, latitude, longitude)
  VALUES($1,$2,$3,$4)
  RETURNING id
  `;
  let values = Object.values(this);
  return client.query(SQL, values);
};

// STATIC METHOD: fetch location from google
Location.fetchLocation = (query) => {
  const _URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;

  return superagent.get(_URL)
    .then(data => {
      console.log('Got data from google API');
      if (!data.body.results.length) { throw 'No Data'; }
      else {
        // create an instance and save it to database
        let location = new Location(query, data.body.results[0]);
        return location.save()
          .then(result => {
            location.id = result.rows[0].id;
            return location;
          });
      }
    });
};

// STATIC METHOD
Location.lookupLocation = (handler) => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1`;
  const values = [handler.query];

  return client.query(SQL, values)
    .then(results => {
      if (results.rowCount > 0) {
        handler.cacheHit(results);
      }
      else {
        handler.cacheMiss();
      }
    })
    .catch(console.error);
};

// WEATHER -------------------------------------------

// Route Handler
function getWeather(request, response) {

  const handler = {
    location: request.query.data,

    cacheHit: function (result) {
      // add created_at
      response.send(result.rows);
    },

    cacheMiss: function () {
      Weather.fetch(request.query.data)
        .then(results => response.send(results))
        .catch(console.error);
    },
  };

  Weather.lookup(handler);
}

// Weather COnstructor/Normalizer
function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
}

// Insrance Method: save location to the database
Weather.prototype.save = function (id) {
  const SQL = `INSERT INTO weathers (forecast, time, location_id) VALUES ($1, $2, $3);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Static Method: Lookup a location in the DB and invoke the proper callback methods based on what you find
// Question -- is anything in here other than the table name esoteric to weather? Is there an opportunity to DRY this out?

Weather.lookup = function (handler) {
  const SQL = `SELECT * FROM weathers WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got data from SQL');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

// Static Method: Fetch a location from the weather API
Weather.fetch = function (location) {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${location.latitude},${location.longitude}`;

  return superagent.get(url)
    .then(result => {
      const weatherSummaries = result.body.daily.data.map(day => {
        const summary = new Weather(day);
        summary.save(location.id);
        return summary;
      });
      return weatherSummaries;
    });
};


app.listen(PORT, () => console.log(`App is up on ${PORT}`));
