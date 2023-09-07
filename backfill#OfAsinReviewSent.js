//backfill company properties in hubspot - Number of ASIN review sent 

const fs = require('fs');
const hubspot = require('@hubspot/api-client');
const hubspotClient = new hubspot.Client({"accessToken":"pat-na1-460eb67a-7e8f-443d-9ec3-277dc38ffa96"});

let apiUsage = 0; // api usage counter, script will stop if this reached 400k
const limit = 100; // limit of list-company api
const archived = false; // default for API calls
let after = undefined; // not really needed

const checkAfter = getAfterFromFile(); // get the recent "after" value from file

// show the starting "after" value in console
if (checkAfter) {
  after = checkAfter;
  console.log('starting after: '+ after);
}

// delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// Save value of 'after' to file
function saveAfterToFile(after) {
    fs.writeFile('after.txt', after.toString(), function (err) {
      if (err) return console.error(err);
      console.log('Saved after:', after);
    });
}


// Read value of 'after' from a file
function getAfterFromFile() {
    try {
      const data = fs.readFileSync('after.txt', 'utf8');
      return parseInt(data);
    } catch (err) {
      console.error(err);
      return null;
    }
}

// call getCompanies function
async function callGetCompanies() {
  let savedAfter = getAfterFromFile();
  getCompanies(savedAfter);
}

// this will get the list of companies max 100 at a time
async function getCompanies(after) {

    try {
      // API request
      const apiPromise = await hubspotClient.crm.companies.basicApi.getPage(limit, after, undefined, undefined, ["emails"], archived);
      const timeoutPromise = delay(5000).then(() => { throw new Error('API call timed out') });
      const apiResponse = await Promise.race([apiPromise, timeoutPromise]);
      apiUsage++ // increment api usage counter by 1
      console.log("API Usage: " + apiUsage)
      
      // Loop through each company ID in the results
      for (const company of apiResponse.results) {
        
        if (!company || !company.associations || !company.associations.emails) {
          // Skip this iteration if company or emails association is missing
          continue;
        }

        const companyId = company.id // get company id from api response

        // if company has email objects associated to it
        if (company.associations.emails.results && company.associations.emails.results.length >= 1) {
          const emails = company.associations.emails.results //get array of emails from association results
          let asinReviewCount = 0 // initialize asin review counter
          let emailSender = undefined // initialize last email sender

          // loop through each email id to check for asin review emails
          for (const email of emails) {
            const emailId = email.id // get email id from api response for email API requirements
            await delay(200) // delay for 0.2 seconds
            const checkEmail = await getEmailInfo(emailId, emailSender) // call email api to check if this email object is an asin review email

            // if the email is indeed an ASIN review email
            if (checkEmail && checkEmail.valid) {
              asinReviewCount += checkEmail.asinReview // increment asin review counter above
              emailSender = checkEmail.emailSender // update email sender variable above
            }
          }

          console.log("Number of ASIN Review Sent: " + asinReviewCount)
          const SimplePublicObjectInput = { properties: {"number_of_asin_review_sent": asinReviewCount} }; // initialize asin review count variable for PATCH request
          await delay(200) // delay for 0.2 seconds
          await updateCompany(companyId, SimplePublicObjectInput) // update "number_of_asin_review_sent" property in hubspot
        }

      };

      // if there is a next page in company api response
      if (apiResponse.paging.next.after) {
        // Save value of 'after' to file
        saveAfterToFile(apiResponse.paging.next.after);
        if (apiUsage == 400000) {
          console.log("Hit daily API quota")
          return
        }
        // Delay 1 second
        await delay(1000);
        // Repeat the script
        await callGetCompanies();
      } else {
        // if final page then print script completed!
        console.log("Script completed!")
        return
      }

    } catch (e) {
      if (e.message === 'API call timed out') {
        console.log('API call timed out, retrying...');
        await delay(1000)
        await getCompanies(after); // repeat the API call
      } else if (e.message === 'HTTP request failed') {
        console.error(JSON.stringify(e.response, null, 2));
        await delay(1000)
        await getCompanies(after); // repeat the API call
      } else {
      e.message === 'HTTP request failed'
        ? console.error(JSON.stringify(e.response, null, 2))
        : console.error(e)
        await delay(1000)
        await getCompanies(after); // repeat the API call
    }
  }
}

// this will get the email info then return the number of ASIN review sent
async function getEmailInfo(emailId, lastEmailSender) {

  // skip if email id is missing
  if (!emailId) {
    return {
      valid: false
    }
  }

  try {
    const apiPromise = hubspotClient.crm.objects.emails.basicApi.getById(emailId, ["hs_email_text", "hs_email_sender_email"], undefined, undefined, archived, undefined);
    const timeoutPromise = delay(5000).then(() => { throw new Error('API call timed out') });
    const apiResponse = await Promise.race([apiPromise, timeoutPromise]);
    apiUsage++ // increment api usage counter by 1
    
    // skip if no email body
    if(!apiResponse.properties.hs_email_text) {
      return {
        valid: false
      }
    }

    const currentEmailSender = apiResponse.properties.hs_email_sender_email
    const emailBody = apiResponse.properties.hs_email_text.split(".")[0]; // splits email body by period and gets the first sentence

    // if email body first sentence contains these words/phrases then it's highly an ASIN Review Email
    if (emailBody.includes("I put together a short video for you about one of your Amazon listings") || emailBody.includes("I put together a short video for you sharing how we've helped brands on Amazon") || emailBody.includes("I noticed your ASIN has some keyword opportunities") || emailBody.includes("Your ASIN has some keyword opportunities") || emailBody.includes("I put together a short video for you about your brand on Amazon") || emailBody.includes("I put together a short video audit for you about one of your Amazon listings and thought you might find it useful")) {
      if (currentEmailSender == lastEmailSender) {

        // if email sender is the same as last this is highly the same asin review email, we should not increment the asin review counter
        return {
          valid: true,
          asinReview: 0,
          emailSender: currentEmailSender
        }
      }

      // if the filter earlier passed then this is highly a new asin review email
      return {
        valid: true,
        asinReview: 1,
        emailSender: currentEmailSender
      }
      
    }

    // if not an ASIN review email then skip
    return {
      valid: false
    }

  } catch (e) {
    if (e.message === 'API call timed out') {
      console.log('API call timed out, retrying...');
      await delay(1000)
      await getEmailInfo(emailId, lastEmailSender); // repeat the API call
    } else if (e.message === 'HTTP request failed') {
      console.error(JSON.stringify(e.response, null, 2));
      await delay(1000)
      await getEmailInfo(emailId, lastEmailSender); // repeat the API call
    } else {
    e.message === 'HTTP request failed'
      ? console.error(JSON.stringify(e.response, null, 2))
      : console.error(e)
      await delay(1000)
      await getEmailInfo(emailId, lastEmailSender); // repeat the API call
    }
  }

}


async function updateCompany (companyId, SimplePublicObjectInput) {
    try {
        const apiPromise = hubspotClient.crm.companies.basicApi.update(companyId, SimplePublicObjectInput);
        const timeoutPromise = delay(5000).then(() => { throw new Error('API call timed out') });
        const apiResponse = await Promise.race([apiPromise, timeoutPromise]);
        apiUsage++ // increment api usage counter
        console.log(apiResponse.id + " has been updated");
    } catch (e) {
        if (e.message === 'API call timed out') {
          console.log('API call timed out, retrying...');
          await delay(1000)
          await updateCompany(companyId, SimplePublicObjectInput); // repeat the API call
        } else if (e.message === 'HTTP request failed') {
          console.error(JSON.stringify(e.response, null, 2));
          await delay(1000)
          await updateCompany(companyId, SimplePublicObjectInput); // repeat the API call
        } else {
        e.message === 'HTTP request failed'
          ? console.error(JSON.stringify(e.response, null, 2))
          : console.error(e)
          await delay(1000)
          await updateCompany(companyId, SimplePublicObjectInput); // repeat the API call
        }
    }
}

// start of the script
callGetCompanies();