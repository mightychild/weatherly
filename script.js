// API Keys and URLs
const WEATHER_API_KEY = '1362459dfaf30dd3ae6abdab69b81c7a';
const GEOCODING_API_URL = 'https://api.openweathermap.org/geo/1.0';
const WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_API_URL = 'https://api.openweathermap.org/data/2.5/forecast';
const AIR_POLLUTION_API_URL = 'https://api.openweathermap.org/data/2.5/air_pollution';

// Cache Config
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes cache lifetime
const MAX_RETRIES = 3; // Max retry attempts for API calls
const BASE_DELAY = 1000; // Initial retry delay in ms

// DOM Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const locationBtn = document.getElementById('location-btn');
const loading = document.getElementById('loading');
const retryContainer = document.getElementById('retry-container');
const retryBtn = document.getElementById('retry-btn');

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    updateDate();
    
    // Try to load cached data first
    const cachedWeather = getFromCache('last_weather');
    if (cachedWeather) {
        updateUIFromCache(cachedWeather);
        showToast('Loaded cached weather data', 'warning');
    }
    
    // Then try to get fresh data
    getWeatherByLocation();
    
    // Event listeners
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
    locationBtn.addEventListener('click', getWeatherByLocation);
    retryBtn.addEventListener('click', handleRetry);
});

// Handle search
function handleSearch() {
    const query = searchInput.value.trim();
    if (query) {
        getWeatherByCity(query);
    }
}

// Handle retry
function handleRetry() {
    retryContainer.style.display = 'none';
    const currentLocation = document.getElementById('location').textContent;
    if (currentLocation.includes(',')) {
        getWeatherByCity(currentLocation);
    } else {
        getWeatherByLocation();
    }
}

// Get weather by city name
async function getWeatherByCity(query) {
    showLoading();
    try {
        // Use smartFetch with caching
        const geoData = await smartFetch(
            `${GEOCODING_API_URL}/direct?q=${query}&limit=5&appid=${WEATHER_API_KEY}`,
            `geo_${query.toLowerCase()}`
        );
        
        if (!geoData || geoData.length === 0) {
            showToast('Location not found', 'error');
            return;
        }
        
        const { lat, lon, name, country, state } = geoData[0];
        const displayName = state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
        searchInput.value = displayName;
        
        // Get all weather data in parallel
        const [weatherData, forecastData] = await Promise.all([
            smartFetch(
                `${WEATHER_API_URL}?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`,
                `weather_${lat}_${lon}`
            ),
            smartFetch(
                `${FORECAST_API_URL}?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_API_KEY}`,
                `forecast_${lat}_${lon}`
            )
        ]);
        
        // Update UI with fresh data
        updateCurrentWeather(weatherData, displayName);
        updateForecast(forecastData);
        updateAirQuality(lat, lon);
        updateWeatherMap(lat, lon);
        updateNearbyCities(lat, lon);
        
        // Save to cache
        saveToCache('last_weather', {
            weather: weatherData,
            forecast: forecastData,
            location: displayName,
            timestamp: Date.now()
        });
        
        showToast('Weather data updated', 'success');
        
    } catch (error) {
        console.error('Error fetching weather data:', error);
        
        // Check if we have any cached data to fall back to
        const cached = getFromCache('last_weather');
        if (cached) {
            showToast('Using cached data', 'warning');
            updateUIFromCache(cached);
        } else {
            showToast('Failed to load data', 'error');
            retryContainer.style.display = 'block';
        }
    } finally {
        hideLoading();
    }
}

// Get weather by user's location
function getWeatherByLocation() {
    showLoading();
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    const { latitude, longitude } = position.coords;
                    
                    // Get city name from coordinates
                    const geoData = await smartFetch(
                        `${GEOCODING_API_URL}/reverse?lat=${latitude}&lon=${longitude}&limit=1&appid=${WEATHER_API_KEY}`,
                        `geo_${latitude}_${longitude}`
                    );
                    
                    if (!geoData || geoData.length === 0) {
                        throw new Error('No location data found');
                    }
                    
                    const { name, country, state } = geoData[0];
                    const displayName = state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
                    searchInput.value = displayName;
                    
                    // Get all weather data
                    await updateWeatherData(latitude, longitude, name, country, state);
                    await updateNearbyCities(latitude, longitude);
                    
                    // Save to cache
                    saveToCache('last_weather', {
                        weather: await smartFetch(
                            `${WEATHER_API_URL}?lat=${latitude}&lon=${longitude}&units=metric&appid=${WEATHER_API_KEY}`,
                            `weather_${latitude}_${longitude}`
                        ),
                        forecast: await smartFetch(
                            `${FORECAST_API_URL}?lat=${latitude}&lon=${longitude}&units=metric&appid=${WEATHER_API_KEY}`,
                            `forecast_${latitude}_${longitude}`
                        ),
                        location: displayName,
                        timestamp: Date.now()
                    });
                    
                } catch (error) {
                    console.error('Error getting location weather:', error);
                    
                    // Fallback to default city if we have no cached data
                    const cached = getFromCache('last_weather');
                    if (!cached) {
                        getWeatherByCity("London");
                    } else {
                        showToast('Using cached data', 'warning');
                    }
                } finally {
                    hideLoading();
                }
            },
            (error) => {
                console.error('Geolocation error:', error);
                hideLoading();
                
                // Fallback to default city if location access denied
                const cached = getFromCache('last_weather');
                if (!cached) {
                    getWeatherByCity("London");
                } else {
                    showToast('Using cached data', 'warning');
                }
            },
            { timeout: 10000 } // 10 second timeout for geolocation
        );
    } else {
        hideLoading();
        showToast('Geolocation not supported', 'error');
        getWeatherByCity("London"); // Fallback to default city
    }
}

// Smart fetch with caching and retry
async function smartFetch(url, cacheKey, retries = MAX_RETRIES) {
    // Try cache first
    const cached = getFromCache(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    let attempt = 0;
    while (attempt < retries) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            saveToCache(cacheKey, data);
            return data;
        } catch (error) {
            attempt++;
            if (attempt >= retries) {
                // If we have cached data, return it even if stale
                if (cached) {
                    showToast('Using cached data (may be outdated)', 'warning');
                    return cached.data;
                }
                throw error;
            }
            
            // Exponential backoff
            const delay = BASE_DELAY * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Cache helpers
function saveToCache(key, data) {
    try {
        const item = {
            data: data,
            timestamp: Date.now()
        };
        localStorage.setItem(`weather_${key}`, JSON.stringify(item));
    } catch (error) {
        console.error('Error saving to cache:', error);
    }
}

function getFromCache(key) {
    try {
        const item = localStorage.getItem(`weather_${key}`);
        return item ? JSON.parse(item) : null;
    } catch (error) {
        console.error('Error reading from cache:', error);
        return null;
    }
}

// Update UI from cached data
function updateUIFromCache(cached) {
    updateCurrentWeather(cached.weather, cached.location);
    if (cached.forecast) {
        updateForecast(cached.forecast);
    }
    // Note: Nearby cities and map won't be updated from cache
}

// Update current weather UI
function updateCurrentWeather(data, location) {
    document.getElementById('location').textContent = location;
    document.getElementById('temp').textContent = `${Math.round(data.main.temp)}°C`;
    document.getElementById('weather-desc').textContent = data.weather[0].description;
    document.getElementById('feels-like').textContent = `${Math.round(data.main.feels_like)}°C`;
    document.getElementById('humidity').textContent = `${data.main.humidity}%`;
    document.getElementById('wind').textContent = `${Math.round(data.wind.speed * 3.6)} km/h`;
    document.getElementById('pressure').textContent = `${data.main.pressure} hPa`;
    
    // Set weather icon
    const iconCode = data.weather[0].icon;
    const iconElement = document.getElementById('weather-icon');
    iconElement.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
    iconElement.alt = data.weather[0].main;
    iconElement.style.background = 'transparent'; // Remove skeleton background
    
    // Update sunrise and sunset times
    const sunriseTime = new Date(data.sys.sunrise * 1000);
    const sunsetTime = new Date(data.sys.sunset * 1000);
    document.getElementById('sunrise').textContent = sunriseTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('sunset').textContent = sunsetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Remove skeleton classes
    document.querySelector('.current-weather').classList.remove('loading');
    document.querySelectorAll('.current-weather .skeleton').forEach(el => {
        el.classList.remove('skeleton');
    });
    
    // Update advice and alerts
    updateWeatherAdvice(data);
    updateWeatherAlerts(data);
}

// Update forecast UI
function updateForecast(data) {
    const forecastContainer = document.getElementById('forecast-container');
    forecastContainer.innerHTML = '';
    
    // Group forecast by day
    const dailyForecast = {};
    data.list.forEach(item => {
        const date = new Date(item.dt * 1000);
        const dateStr = date.toLocaleDateString();
        
        if (!dailyForecast[dateStr]) {
            dailyForecast[dateStr] = {
                temps: [],
                icons: [],
                desc: item.weather[0].description,
                main: item.weather[0].main,
                date: date
            };
        }
        
        dailyForecast[dateStr].temps.push(item.main.temp);
        dailyForecast[dateStr].icons.push(item.weather[0].icon);
    });
    
    // Get the next 5 days
    const forecastDays = Object.values(dailyForecast).slice(0, 5);
    
    forecastDays.forEach(day => {
        const dayName = day.date.toLocaleDateString('en-US', { weekday: 'short' });
        const maxTemp = Math.max(...day.temps);
        const minTemp = Math.min(...day.temps);
        
        // Use the most frequent icon
        const iconCounts = {};
        day.icons.forEach(icon => {
            iconCounts[icon] = (iconCounts[icon] || 0) + 1;
        });
        const mostFrequentIcon = Object.keys(iconCounts).reduce((a, b) => 
            iconCounts[a] > iconCounts[b] ? a : b
        );
        
        const forecastItem = document.createElement('div');
        forecastItem.className = 'forecast-item';
        forecastItem.innerHTML = `
            <div class="forecast-day">${dayName}</div>
            <img class="forecast-icon" src="https://openweathermap.org/img/wn/${mostFrequentIcon}.png" alt="${day.main}">
            <p class="forecast-desc">${day.desc}</p>
            <div class="forecast-temp">
                <span class="forecast-max">${Math.round(maxTemp)}°</span>
                <span class="forecast-min">${Math.round(minTemp)}°</span>
            </div>
        `;
        forecastContainer.appendChild(forecastItem);
    });
}

// Update nearby cities UI
async function updateNearbyCities(lat, lon) {
    try {
        const citiesData = await smartFetch(
            `${GEOCODING_API_URL}/reverse?lat=${lat}&lon=${lon}&limit=5&appid=${WEATHER_API_KEY}`,
            `nearby_${lat}_${lon}`
        );
        
        if (!citiesData || citiesData.length === 0) return;
        
        // Get weather for each nearby city
        const citiesWithWeather = await Promise.all(
            citiesData.slice(0, 3).map(async (location) => {
                try {
                    const weather = await smartFetch(
                        `${WEATHER_API_URL}?lat=${location.lat}&lon=${location.lon}&units=metric&appid=${WEATHER_API_KEY}`,
                        `weather_${location.lat}_${location.lon}`
                    );
                    
                    return {
                        name: location.name || "Unknown",
                        country: location.country || "",
                        state: location.state || "",
                        distance: calculateDistance(lat, lon, location.lat, location.lon),
                        temp: Math.round(weather.main?.temp) || "--",
                        icon: weather.weather?.[0]?.icon || "01d",
                        desc: weather.weather?.[0]?.main || "Unknown"
                    };
                } catch (error) {
                    console.error('Error getting nearby city weather:', error);
                    return null;
                }
            })
        );
        
        // Filter out failed requests
        const validCities = citiesWithWeather.filter(city => city !== null);
        if (validCities.length === 0) return;
        
        // Update UI
        const container = document.getElementById('nearby-cities-container');
        container.innerHTML = '';
        
        validCities.forEach(city => {
            const cityCard = document.createElement('div');
            cityCard.className = 'city-card';
            cityCard.addEventListener('click', () => {
                const query = city.state ? `${city.name}, ${city.state}, ${city.country}` : `${city.name}, ${city.country}`;
                searchInput.value = query;
                getWeatherByCity(query);
            });
            
            cityCard.innerHTML = `
                <div class="city-name">${city.name}, ${city.country}</div>
                <div class="city-distance">${city.distance} km away</div>
                <div class="city-weather">
                    <div class="city-temp">${city.temp}°C</div>
                    <img class="city-icon" src="https://openweathermap.org/img/wn/${city.icon}.png" alt="${city.desc}">
                </div>
            `;
            container.appendChild(cityCard);
        });
        
    } catch (error) {
        console.error('Error updating nearby cities:', error);
    }
}

// Calculate distance between coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
}

// Update weather advice
function updateWeatherAdvice(data) {
    const adviceContainer = document.getElementById('advice-container');
    adviceContainer.innerHTML = '';
    
    const temp = data.main.temp;
    const weatherMain = data.weather[0].main;
    const humidity = data.main.humidity;
    const windSpeed = data.wind.speed;
    
    const adviceList = [];
    
    // Temperature advice
    if (temp > 30) {
        adviceList.push({
            icon: 'fas fa-temperature-high',
            title: 'Hot Weather Advisory',
            text: 'Drink plenty of water to stay hydrated. Avoid prolonged sun exposure and wear light, loose clothing.'
        });
    } else if (temp < 10) {
        adviceList.push({
            icon: 'fas fa-temperature-low',
            title: 'Cold Weather Advisory',
            text: 'Wear layers including a warm sweater or jacket. Protect extremities from cold with gloves and hats.'
        });
    }
    
    // Precipitation advice
    if (['Rain', 'Drizzle', 'Thunderstorm'].includes(weatherMain)) {
        adviceList.push({
            icon: 'fas fa-umbrella',
            title: 'Rain Advisory',
            text: 'Carry an umbrella or raincoat. Expect slippery roads and possible travel delays.'
        });
    } else if (weatherMain === 'Snow') {
        adviceList.push({
            icon: 'fas fa-snowflake',
            title: 'Snow Advisory',
            text: 'Wear waterproof boots and warm layers. Be cautious of icy surfaces when walking.'
        });
    }
    
    // Wind advice
    if (windSpeed > 20) {
        adviceList.push({
            icon: 'fas fa-wind',
            title: 'Wind Advisory',
            text: 'Secure loose outdoor items. Be cautious when driving high-profile vehicles.'
        });
    }
    
    // Humidity advice
    if (humidity > 70) {
        adviceList.push({
            icon: 'fas fa-water',
            title: 'High Humidity',
            text: 'Stay hydrated. Consider using dehumidifiers indoors. Be aware of possible mold growth.'
        });
    } else if (humidity < 30) {
        adviceList.push({
            icon: 'fas fa-tint',
            title: 'Low Humidity',
            text: 'Use moisturizers and lip balm. Consider a humidifier to prevent dry skin and respiratory irritation.'
        });
    }
    
    // Default advice if no specific conditions
    if (adviceList.length === 0) {
        adviceList.push({
            icon: 'fas fa-check-circle',
            title: 'Pleasant Weather',
            text: 'Conditions are ideal for outdoor activities. Enjoy the nice weather!'
        });
    }
    
    // Add clothing recommendation
    adviceList.push(generateClothingAdvice(temp, weatherMain));
    
    // Add travel advice
    adviceList.push(generateTravelAdvice(weatherMain, windSpeed));
    
    // Display all advice
adviceList.forEach(advice => {
        const adviceCard = document.createElement('div');
        adviceCard.className = 'advice-card';
        adviceCard.innerHTML = `
            <i class="${advice.icon} advice-icon"></i>
            <div class="advice-content">
                <h4>${advice.title}</h4>
                <p>${advice.text}</p>
            </div>
        `;
        adviceContainer.appendChild(adviceCard);
    });
}

// Generate clothing advice
function generateClothingAdvice(temp, weatherMain) {
    let clothingAdvice = '';
    let icon = 'fas fa-tshirt';
    
    if (temp > 25) {
        clothingAdvice = 'Light clothing like t-shirts and shorts are recommended. Choose breathable fabrics.';
    } else if (temp > 18) {
        clothingAdvice = 'Light layers are ideal. Consider a light jacket or sweater for cooler evenings.';
    } else if (temp > 10) {
        clothingAdvice = 'Wear a jacket or sweater. Consider thermal layers if sensitive to cold.';
    } else if (temp > 0) {
        clothingAdvice = 'Dress warmly with multiple layers. Winter coat, hat, and gloves recommended.';
        icon = 'fas fa-mitten';
    } else {
        clothingAdvice = 'Extreme cold weather gear needed. Heavy coat, insulated gloves, hat, and scarf essential.';
        icon = 'fas fa-icicles';
    }
    
    // Adjust for precipitation
    if (['Rain', 'Drizzle'].includes(weatherMain)) {
        clothingAdvice += ' Waterproof outer layer recommended.';
        icon = 'fas fa-umbrella';
    } else if (weatherMain === 'Snow') {
        clothingAdvice += ' Waterproof and insulated boots essential.';
        icon = 'fas fa-snowplow';
    }
    
    return {
        icon: icon,
        title: 'Clothing Recommendation',
        text: clothingAdvice
    };
}

// Generate travel advice
function generateTravelAdvice(weatherMain, windSpeed) {
    let travelAdvice = '';
    let icon = 'fas fa-car';
    let title = 'Travel Conditions';
    
    switch(weatherMain) {
        case 'Rain':
            travelAdvice = 'Wet roads may increase stopping distances. Allow extra travel time.';
            icon = 'fas fa-car-crash';
            break;
        case 'Snow':
            travelAdvice = 'Snow may create hazardous driving conditions. Consider postponing non-essential travel.';
            icon = 'fas fa-snowplow';
            title = 'Winter Travel Advisory';
            break;
        case 'Thunderstorm':
            travelAdvice = 'Avoid travel during thunderstorms. If driving, be alert for sudden wind gusts and reduced visibility.';
            icon = 'fas fa-bolt';
            title = 'Storm Travel Advisory';
            break;
        case 'Fog':
            travelAdvice = 'Reduced visibility expected. Use low-beam headlights and increase following distance.';
            icon = 'fas fa-fog';
            break;
        default:
            if (windSpeed > 15) {
                travelAdvice = 'Windy conditions may affect high-profile vehicles. Secure loose items in truck beds.';
                icon = 'fas fa-wind';
            } else {
                travelAdvice = 'Normal travel conditions expected. Safe travels!';
                icon = 'fas fa-road';
            }
    }
    
    return {
        icon: icon,
        title: title,
        text: travelAdvice
    };
}

// Update weather alerts
function updateWeatherAlerts(data) {
    const alertsContainer = document.getElementById('alerts-container');
    alertsContainer.innerHTML = '';
    
    const alerts = [];
    
    if (data.weather[0].main === 'Thunderstorm') {
        alerts.push({
            event: 'Thunderstorm Warning',
            description: 'Potential for dangerous lightning, heavy rain, and possible hail. Seek shelter indoors.'
        });
    }
    
    if (data.wind.speed > 25) {
        alerts.push({
            event: 'High Wind Advisory',
            description: 'Strong winds may cause power outages and make driving difficult, especially for high-profile vehicles.'
        });
    }
    
    if (data.main.temp > 35) {
        alerts.push({
            event: 'Heat Advisory',
            description: 'Extreme heat may cause heat-related illnesses. Stay hydrated and limit outdoor activities.'
        });
    } else if (data.main.temp < -5) {
        alerts.push({
            event: 'Freeze Warning',
            description: 'Frost and freeze conditions may damage plants and create hazardous road conditions.'
        });
    }
    
    if (alerts.length === 0) {
        const noAlertCard = document.createElement('div');
        noAlertCard.className = 'alert-card';
        noAlertCard.style.background = 'rgba(46, 204, 113, 0.2)';
        noAlertCard.style.borderLeftColor = '#2ecc71';
        noAlertCard.innerHTML = `
            <i class="fas fa-check-circle alert-icon" style="color: #2ecc71"></i>
            <div class="alert-content">
                <h4 style="color: #2ecc71">No Active Alerts</h4>
                <p>No severe weather alerts for your area at this time.</p>
            </div>
        `;
        alertsContainer.appendChild(noAlertCard);
    } else {
        alerts.forEach(alert => {
            const alertCard = document.createElement('div');
            alertCard.className = 'alert-card';
            alertCard.innerHTML = `
                <i class="fas fa-exclamation-triangle alert-icon"></i>
                <div class="alert-content">
                    <h4>${alert.event}</h4>
                    <p>${alert.description}</p>
                </div>
            `;
            alertsContainer.appendChild(alertCard);
        });
    }
}

// Update air quality
function updateAirQuality(lat, lon) {
    // Mock data - in a real app you would call the air pollution API
    const aqi = Math.floor(Math.random() * 150) + 1;
    document.getElementById('aqi-value').textContent = aqi;
    
    updateUIStyle(aqi, 'aqi-value', 'aqi-text', [
        { max: 50, text: 'Good', color: '#2ecc71' },
        { max: 100, text: 'Moderate', color: '#f1c40f' },
        { max: 150, text: 'Unhealthy', color: '#e67e22' },
        { max: 200, text: 'Very Unhealthy', color: '#e74c3c' },
        { max: Infinity, text: 'Hazardous', color: '#8e44ad' }
    ]);
    
    // Remove skeleton class
    document.getElementById('aqi-value').classList.remove('skeleton');
    document.getElementById('aqi-text').classList.remove('skeleton');
}

// Update interactive weather map
function updateWeatherMap(lat, lon) {
    const map = document.getElementById('weather-map');
    map.src = `https://openweathermap.org/weathermap?basemap=map&cities=true&layer=radar&lat=${lat}&lon=${lon}&zoom=8`;
}

// Update UI style based on value ranges
function updateUIStyle(value, valueElementId, textElementId, ranges) {
    const valueElement = document.getElementById(valueElementId);
    let bgColor = '';
    let text = '';
    
    for (const range of ranges) {
        if (value <= range.max) {
            bgColor = range.color;
            text = range.text;
            break;
        }
    }
    
    valueElement.style.backgroundColor = bgColor;
    if (textElementId) {
        document.getElementById(textElementId).textContent = text;
    }
}

// Update date display
function updateDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('date').textContent = now.toLocaleDateString('en-US', options);
    document.getElementById('date').classList.remove('skeleton');
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.getElementById('toast-container').appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Show loading overlay
function showLoading() {
    loading.style.display = 'flex';
}

// Hide loading overlay
function hideLoading() {
    loading.style.display = 'none';
}
