
// extracting contest id
const contest_Title=document.querySelector(".contest-name a")?.href ?? window.location.href;
const contestMatch = contest_Title.match(/\/contest\/(\d+)/);
const contestId = contestMatch ? Number(contestMatch[1]) : 0;

const userList=new Set();

// extracting participants username
const table = document.querySelectorAll(".standings tbody .contestant-cell")
for(const user of table){
    userList.add(user.textContent.replace(/[ *#]/g, "").trim());
}
const queryData={contestId,userList:[...userList]};

function updatePage(res){
    if (document.querySelector(".carrot-performance-header")) {
        return;
    }

    const data={};
    for(const user of res){
        data[user.handle]={"delta":user.delta,"performance":user.performance};
    }
    const location =document.querySelector(".standings tr");
    const pref=document.createElement("th")
    const delta=document.createElement("th")
    pref.classList.add("carrot-performance-header");
    delta.classList.add("carrot-delta-header");
    pref.textContent="Performance";
    delta.textContent="Delta";
    location.append(pref);
    location.append(delta);

    const table = document.querySelectorAll(".standings tbody tr");

    for(let i=0;i<table.length;i++){
        const user=table[i];
        const handle=user.querySelector(".contestant-cell")
        if (!handle) {
            continue;
        }

        const userName=handle.textContent.replace(/[ *#]/g, "").trim();


        const pref=document.createElement("td")
        const delta=document.createElement("td")

        if(data[userName]!==undefined) {

            const userPref=data[userName]["performance"];
            const userDelta=data[userName]["delta"];


            pref.textContent=userPref;
            delta.textContent=userDelta;


            // delta coloring
            if (userDelta > 0) {
                delta.classList.add('carrot-delta-positive');
                delta.textContent = `+${userDelta}`;
            } else{
                delta.classList.add('carrot-delta-negative');
                delta.textContent = `${userDelta}`;
            }
            pref.style.fontWeight = 'bold';
            // performance coloring
            if (userPref < 1200) {
                pref.classList.add('newbie');
            } else if (userPref < 1400) {
                pref.classList.add('pupil');
            } else if (userPref < 1600) {
                pref.classList.add('specialist');
            } else if (userPref < 1900) {
                pref.classList.add('expert');
            } else if (userPref < 2100) {
                pref.classList.add('candidate-master');
            } else if (userPref < 2300) {
                pref.classList.add('master');
            } else if (userPref < 2400) {
                pref.classList.add('international-master');
            } else if (userPref < 2600) {
                pref.classList.add('grandmaster');
            } else if (userPref < 3000) {
                pref.classList.add('international-grandmaster');
            } else {
                pref.classList.add('legendary-grandmaster');
            }
        }


        // gray coloring for table
        if (i % 2 === 1) {
            pref.classList.add('carrot-dark');
            delta.classList.add('carrot-dark');
        }

        user.append(pref);
        user.append(delta);
    }
}

const testURL="http://127.0.0.1:3000/contest";
// const apiURL="http://127.0.0.1:3000/contest";

if (contestId > 0 && queryData.userList.length > 0) {
    fetch(testURL,{
        method:"POST",
        headers: {
            'Content-Type': 'application/json', // Indicate the content type
        },
        body:JSON.stringify(queryData),
    }).then(async res => {
        if (!res.ok) {
            throw new Error(`Backend returned ${res.status}`);
        }
        return res.json();
    }).then((res)=> {
        if (!Array.isArray(res)) {
            throw new Error("Backend response is not a list");
        }
        updatePage(res);
    }) .catch(error => {
        console.error('Error fetching data:', error); // Handle network errors
    });
}

